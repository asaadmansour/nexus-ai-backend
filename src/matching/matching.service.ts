import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AiService } from 'src/agents/ai.service';
import type { MatchCandidateInputDto } from 'src/agents/dto/MatchFreelancersDto';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Brief } from 'src/projects/entities/brief.entity';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectStatusHistory } from 'src/projects/entities/project-status-history.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { MatchingCandidate } from './entities/matching-candidate.entity';
import { MatchingRun } from './entities/matching-run.entity';
import { StartPlanningMatchingDto } from './dtos/start-planning-matching.dto';
import { UpdateCandidateStatusDto } from './dtos/update-candidate-status.dto';
import { ReviewRunDto } from './dtos/review-run.dto';

const PLANNING_ROLES = ['architect', 'ui_ux'];
const DEFAULT_LIMIT = 10;

// Budget-aware rate cap for planning matching. The project budget is a total
// lump sum, so we convert it into an affordable hourly rate: planning takes a
// share of the budget, split across the planning roles, over a rough per-role
// effort. These are tunable product assumptions.
const PLANNING_BUDGET_SHARE = 0.2; // planning ≈ 20% of the total project budget
const PLANNING_HOURS_PER_ROLE = 40; // a planning deliverable ≈ one focused week
const MIN_AFFORDABLE_POOL = 3; // below this, relax the cap so the pool isn't empty

// Sensible default required-skills per planning role, used when the admin does
// not pass explicit `filters.skills`. Lets the architect and ui_ux runs rank
// against role-relevant skills instead of one shared list.
const PLANNING_ROLE_SKILLS: Record<string, string[]> = {
  architect: [
    'System Design',
    'API Design',
    'Database Design',
    'PostgreSQL',
    'NestJS',
    'Node.js',
    'Backend',
    'Security',
    'Microservices',
    'Scalability',
  ],
  ui_ux: [
    'Figma',
    'Design Systems',
    'User Flows',
    'Wireframing',
    'Prototyping',
    'UI Design',
    'UX Research',
    'Accessibility',
    'Ecommerce UX',
    'Responsive Design',
  ],
};
const MATCH_START_ALLOWED_STATUSES = new Set<ProjectStatus>([
  ProjectStatus.BRIEF_COMPLETE,
  ProjectStatus.PLANNING_MATCHING,
]);
const ASSIGNMENT_ACTIVE_STATUSES = ['assigned', 'accepted', 'in_progress'];

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @InjectRepository(MatchingRun)
    private readonly runRepo: Repository<MatchingRun>,
    @InjectRepository(MatchingCandidate)
    private readonly candidateRepo: Repository<MatchingCandidate>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Brief)
    private readonly briefRepo: Repository<Brief>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    private readonly aiService: AiService,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Start planning-role matching
  // ---------------------------------------------------------------------------

  // Automatically triggered when a project's brief becomes complete. No-ops if
  // matching already ran or the project is not startable, and never throws — it
  // must not disrupt the brief-completion flow that calls it.
  async autoStartPlanningRoles(projectId: string): Promise<void> {
    try {
      const existingRuns = await this.runRepo.count({ where: { projectId } });
      if (existingRuns > 0) return;

      const project = await this.projectRepo.findOne({ where: { id: projectId } });
      if (!project || project.status !== ProjectStatus.BRIEF_COMPLETE) return;

      await this.startPlanningRoles(
        projectId,
        {} as StartPlanningMatchingDto,
        null,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Auto-start matching failed for project ${projectId}: ${message}`,
      );
    }
  }

  async startPlanningRoles(
    projectId: string,
    dto: StartPlanningMatchingDto,
    adminUserId: string | null,
  ) {
    const project = await this.getProject(projectId);
    if (!MATCH_START_ALLOWED_STATUSES.has(project.status)) {
      throw new BadRequestException(
        'Planning matching can only start after the brief is complete',
      );
    }

    const roles = dto.roles?.length
      ? Array.from(new Set(dto.roles))
      : [...PLANNING_ROLES];

    const brief = await this.briefRepo.findOne({ where: { projectId } });
    const { candidates } = await this.buildCandidatePool(dto, brief, project);
    const limit = dto.filters?.limit ?? DEFAULT_LIMIT;

    // Create the runs and flip the project up front, in a short transaction, so
    // the (potentially slow) AI calls do not hold a DB transaction open.
    const runs = await this.dataSource.transaction(async (manager) => {
      const created: MatchingRun[] = [];
      for (const role of roles) {
        created.push(
          await manager.save(
            MatchingRun,
            manager.create(MatchingRun, {
              projectId,
              targetType: 'planning_role',
              targetRoleKey: role,
              status: 'running',
              requestedBy: adminUserId,
              filters: dto.filters ? { ...dto.filters } : null,
              inputSnapshot: {
                candidatePoolSize: candidates.length,
                filters: dto.filters ?? null,
              },
              startedAt: new Date(),
            }),
          ),
        );
      }
      await this.transitionProject(manager, project, adminUserId, {
        status: ProjectStatus.PLANNING_MATCHING,
        planningStatus: 'matching',
        reason: 'Started planning-role matching.',
        setPlanningStartedAt: true,
      });
      return created;
    });

    const projectSnapshot = this.buildProjectSnapshot(project, dto);
    const briefSnapshot = this.buildBriefSnapshot(brief);
    const runResults: Record<string, unknown>[] = [];

    for (const run of runs) {
      try {
        // Rank against role-specific skills (admin override, else per-role default).
        const roleSkills = dto.filters?.skills?.length
          ? dto.filters.skills
          : (PLANNING_ROLE_SKILLS[run.targetRoleKey!] ?? []);
        const ai = await this.aiService.matchFreelancers({
          matchingRunId: run.id,
          targetRoleKey: run.targetRoleKey!,
          limit,
          project: { ...projectSnapshot, requiredSkills: roleSkills },
          brief: briefSnapshot,
          candidates,
        });

        const candidateCount = await this.dataSource.transaction(
          async (manager) => {
            const rows = ai.candidates.map((candidate) =>
              manager.create(MatchingCandidate, {
                matchingRunId: run.id,
                freelancerProfileId: candidate.freelancerProfileId,
                rank: candidate.rank,
                score: candidate.score.toFixed(2),
                scoreBreakdown: candidate.scoreBreakdown,
                rationale: candidate.rationale,
                evidence: candidate.evidence,
                status: 'recommended',
              }),
            );
            if (rows.length) {
              await manager.save(MatchingCandidate, rows);
            }
            run.status = 'completed';
            run.completedAt = new Date();
            run.summary = ai.summary;
            await manager.save(MatchingRun, run);
            return rows.length;
          },
        );

        runResults.push({
          id: run.id,
          targetType: 'planning_role',
          targetRoleKey: run.targetRoleKey,
          status: 'completed',
          candidateCount,
          summary: ai.summary,
        });
      } catch (error) {
        const message = this.errorMessage(error);
        this.logger.error(`Matching run ${run.id} failed: ${message}`);
        run.status = 'failed';
        run.error = message;
        await this.runRepo.save(run);
        runResults.push({
          id: run.id,
          targetType: 'planning_role',
          targetRoleKey: run.targetRoleKey,
          status: 'failed',
          candidateCount: 0,
          error: message,
        });
      }
    }

    return {
      projectId,
      projectStatus: ProjectStatus.PLANNING_MATCHING,
      planningStatus: 'matching',
      runs: runResults,
    };
  }

  // ---------------------------------------------------------------------------
  // List / detail
  // ---------------------------------------------------------------------------

  async listRuns(
    projectId: string,
    query: {
      status?: string;
      targetRoleKey?: string;
      page: number;
      limit: number;
    },
  ) {
    await this.getProject(projectId);

    const where: Record<string, unknown> = { projectId };
    if (query.status) where.status = query.status;
    if (query.targetRoleKey) where.targetRoleKey = query.targetRoleKey;

    const [runs, total] = await this.runRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    const counts = await this.getCandidateCounts(runs.map((run) => run.id));
    const selected = await this.getSelectedCandidateIds(runs.map((r) => r.id));

    const data = runs.map((run) => ({
      id: run.id,
      projectId: run.projectId,
      targetType: run.targetType,
      targetRoleKey: run.targetRoleKey,
      status: run.status,
      summary: run.summary,
      candidateCount: counts.get(run.id) ?? 0,
      selectedCandidateId: selected.get(run.id) ?? null,
      reviewedBy: run.reviewedBy,
      reviewedAt: run.reviewedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    }));

    return { data, total };
  }

  async adminListRuns(query: { status?: string; page: number; limit: number }) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;

    const [runs, total] = await this.runRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      relations: ['project'],
    });

    const counts = await this.getCandidateCounts(runs.map((run) => run.id));

    const data = runs.map((run) => ({
      id: run.id,
      projectId: run.projectId,
      projectTitle: run.project?.title ?? null,
      targetType: run.targetType,
      targetRoleKey: run.targetRoleKey,
      status: run.status,
      summary: run.summary,
      candidateCount: counts.get(run.id) ?? 0,
      reviewedAt: run.reviewedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    }));
    return { data, total };
  }

  async getRun(runId: string) {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Matching run not found');

    const candidates = await this.candidateRepo.find({
      where: { matchingRunId: runId },
      order: { rank: 'ASC' },
      relations: ['freelancerProfile', 'freelancerProfile.user'],
    });

    return {
      id: run.id,
      projectId: run.projectId,
      targetType: run.targetType,
      targetRoleKey: run.targetRoleKey,
      status: run.status,
      filters: run.filters,
      inputSnapshot: run.inputSnapshot,
      summary: run.summary,
      error: run.error,
      reviewedBy: run.reviewedBy,
      reviewedAt: run.reviewedAt,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        matchingRunId: candidate.matchingRunId,
        freelancerProfileId: candidate.freelancerProfileId,
        rank: candidate.rank,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown,
        rationale: candidate.rationale,
        evidence: candidate.evidence,
        status: candidate.status,
        freelancer: this.buildFreelancerSummary(candidate.freelancerProfile),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Candidate status
  // ---------------------------------------------------------------------------

  async updateCandidateStatus(
    candidateId: string,
    dto: UpdateCandidateStatusDto,
    adminUserId: string,
  ) {
    if (dto.status === 'rejected' && !dto.reason?.trim()) {
      throw new BadRequestException(
        'A reason is required to reject a candidate',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const candidate = await manager.findOne(MatchingCandidate, {
        where: { id: candidateId },
      });
      if (!candidate) throw new NotFoundException('Candidate not found');

      if (dto.status === 'selected') {
        await manager
          .createQueryBuilder()
          .update(MatchingCandidate)
          .set({ status: 'shortlisted' })
          .where('matching_run_id = :runId', {
            runId: candidate.matchingRunId,
          })
          .andWhere('id != :id', { id: candidate.id })
          .andWhere('status = :selected', { selected: 'selected' })
          .execute();

        candidate.status = 'selected';
        candidate.selectedBy = adminUserId;
        candidate.selectedAt = new Date();
        candidate.rejectionReason = null;
      } else if (dto.status === 'rejected') {
        candidate.status = 'rejected';
        candidate.rejectionReason = dto.reason ?? null;
      } else {
        candidate.status = 'shortlisted';
      }

      await manager.save(MatchingCandidate, candidate);

      return {
        id: candidate.id,
        status: candidate.status,
        selectedBy: candidate.selectedBy,
        selectedAt: candidate.selectedAt,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Review run (+ optional assignment)
  // ---------------------------------------------------------------------------

  async reviewRun(runId: string, dto: ReviewRunDto, adminUserId: string) {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Matching run not found');
    if (dto.decision === 'approved' && !dto.selectedCandidateId) {
      throw new BadRequestException(
        'selectedCandidateId is required to approve a matching run',
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      run.reviewedBy = adminUserId;
      run.reviewedAt = new Date();
      run.status = dto.decision === 'rerun_required' ? 'completed' : 'reviewed';
      await manager.save(MatchingRun, run);

      if (dto.decision !== 'approved') {
        return { assignment: null, notifyUserId: null as string | null };
      }

      const candidate = await manager.findOne(MatchingCandidate, {
        where: { id: dto.selectedCandidateId!, matchingRunId: run.id },
        relations: ['freelancerProfile'],
      });
      if (!candidate || !candidate.freelancerProfileId) {
        throw new NotFoundException(
          'Selected candidate not found for this run',
        );
      }

      candidate.status = 'selected';
      candidate.selectedBy = adminUserId;
      candidate.selectedAt = candidate.selectedAt ?? new Date();
      await manager.save(MatchingCandidate, candidate);

      if (!dto.createAssignment) {
        return { assignment: null, notifyUserId: null };
      }

      const assignment = await this.createPlanningAssignment(manager, {
        run,
        candidate,
        adminUserId,
        notes: dto.notes ?? null,
      });
      candidate.status = 'assigned';
      await manager.save(MatchingCandidate, candidate);

      await this.maybeAdvanceToPlanningAssigned(
        manager,
        run.projectId,
        adminUserId,
      );

      return {
        assignment,
        notifyUserId: candidate.freelancerProfile?.userId ?? null,
      };
    });

    if (result.notifyUserId && result.assignment) {
      await this.notificationsService.createNotification({
        userId: result.notifyUserId,
        projectId: run.projectId,
        title: 'New planning assignment',
        body: `You were assigned as ${run.targetRoleKey} for a project.`,
      });
    }

    return {
      runId: run.id,
      status: run.status,
      assignment: result.assignment
        ? {
            id: result.assignment.id,
            projectId: result.assignment.projectId,
            phase: result.assignment.phase,
            roleKey: result.assignment.roleKey,
            status: result.assignment.status,
            freelancerProfileId: result.assignment.freelancerProfileId,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async createPlanningAssignment(
    manager: EntityManager,
    input: {
      run: MatchingRun;
      candidate: MatchingCandidate;
      adminUserId: string;
      notes: string | null;
    },
  ): Promise<ProjectRoleAssignment> {
    const { run, candidate, adminUserId, notes } = input;
    const roleKey = run.targetRoleKey!;

    const existing = await manager.findOne(ProjectRoleAssignment, {
      where: {
        projectId: run.projectId,
        phase: 'planning',
        roleKey,
      },
    });
    if (existing && ASSIGNMENT_ACTIVE_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        `An active ${roleKey} planning assignment already exists for this project`,
      );
    }

    const profile = candidate.freelancerProfile;
    return manager.save(
      ProjectRoleAssignment,
      manager.create(ProjectRoleAssignment, {
        projectId: run.projectId,
        freelancerProfileId: candidate.freelancerProfileId,
        phase: 'planning',
        roleKey,
        status: 'assigned',
        sourceMatchingRunId: run.id,
        sourceCandidateId: candidate.id,
        assignedBy: adminUserId,
        hourlyRateSnapshot: profile?.hourlyRate ?? null,
        availabilityHoursSnapshot: profile?.availabilityHoursPerWeek ?? null,
        scoreSnapshot: {
          matchingCandidateId: candidate.id,
          score: Number(candidate.score),
        },
        notes,
        assignedAt: new Date(),
      }),
    );
  }

  private async maybeAdvanceToPlanningAssigned(
    manager: EntityManager,
    projectId: string,
    adminUserId: string,
  ) {
    const activeRoles = await manager
      .createQueryBuilder(ProjectRoleAssignment, 'a')
      .select('DISTINCT a.role_key', 'roleKey')
      .where('a.project_id = :projectId', { projectId })
      .andWhere('a.phase = :phase', { phase: 'planning' })
      .andWhere('a.status IN (:...statuses)', {
        statuses: ASSIGNMENT_ACTIVE_STATUSES,
      })
      .getRawMany<{ roleKey: string }>();

    const roleSet = new Set(activeRoles.map((row) => row.roleKey));
    if (!PLANNING_ROLES.every((role) => roleSet.has(role))) return;

    const project = await manager.findOne(Project, {
      where: { id: projectId },
    });
    if (!project || project.status === ProjectStatus.PLANNING_ASSIGNED) return;

    await this.transitionProject(manager, project, adminUserId, {
      status: ProjectStatus.PLANNING_ASSIGNED,
      planningStatus: 'assigned',
      reason: 'Both planning roles assigned.',
      setAssignedAt: true,
    });
  }

  private async transitionProject(
    manager: EntityManager,
    project: Project,
    adminUserId: string | null,
    change: {
      status: ProjectStatus;
      planningStatus: string;
      reason: string;
      setPlanningStartedAt?: boolean;
      setAssignedAt?: boolean;
    },
  ) {
    const oldStatus = project.status;
    project.status = change.status;
    project.planningStatus = change.planningStatus;
    if (change.setPlanningStartedAt) {
      project.planningStartedAt = project.planningStartedAt ?? new Date();
    }
    if (change.setAssignedAt) {
      project.assignedAt = project.assignedAt ?? new Date();
    }
    await manager.save(Project, project);

    if (oldStatus !== change.status) {
      await manager.save(
        ProjectStatusHistory,
        manager.create(ProjectStatusHistory, {
          projectId: project.id,
          oldStatus,
          newStatus: change.status,
          changedBy: adminUserId,
          changedByType: adminUserId ? 'admin' : 'system',
          reason: change.reason,
        }),
      );
    }
  }

  // Max hourly rate the budget can afford for a planning role. Returns null if
  // the project has no usable budget (then no budget cap is applied).
  private affordablePlanningRate(project: Project): number | null {
    const budgetMax =
      project.budgetMax != null ? Number(project.budgetMax) : null;
    if (!budgetMax || budgetMax <= 0) return null;
    const perRoleBudget =
      (budgetMax * PLANNING_BUDGET_SHARE) / PLANNING_ROLES.length;
    return Math.round(perRoleBudget / PLANNING_HOURS_PER_ROLE);
  }

  private async buildCandidatePool(
    dto: StartPlanningMatchingDto,
    brief: Brief | null,
    project: Project,
  ) {
    const filters = dto.filters;
    const qb = this.profileRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.skillScores', 's')
      .leftJoinAndSelect('p.user', 'u')
      .where('p.verificationStatus = :approved', { approved: 'approved' })
      .andWhere('p.deletedAt IS NULL')
      .andWhere('p.isAvailable = true');

    if (filters?.minAvailabilityHours != null) {
      qb.andWhere('COALESCE(p.availabilityHoursPerWeek, 0) >= :minAvail', {
        minAvail: filters.minAvailabilityHours,
      });
    }
    if (filters?.includeFreelancerIds?.length) {
      qb.andWhere('p.id IN (:...include)', {
        include: filters.includeFreelancerIds,
      });
    }
    if (filters?.excludeFreelancerIds?.length) {
      qb.andWhere('p.id NOT IN (:...exclude)', {
        exclude: filters.excludeFreelancerIds,
      });
    }

    // Budget-aware rate cap: only match freelancers the budget can afford. An
    // explicit admin maxHourlyRate wins; otherwise derive one from the budget.
    const maxRate = filters?.maxHourlyRate ?? this.affordablePlanningRate(project);
    const cappedQb = qb.clone();
    if (maxRate != null) {
      cappedQb.andWhere('(p.hourlyRate IS NULL OR p.hourlyRate <= :maxRate)', {
        maxRate,
      });
    }

    const poolCap = filters?.limit ? Math.min(filters.limit * 4, 100) : 60;
    let profiles = await cappedQb.take(poolCap).getMany();

    // If the budget cap left too few options, relax it — never return an empty
    // pool just because rates are high; the admin still needs candidates.
    if (
      maxRate != null &&
      filters?.maxHourlyRate == null &&
      profiles.length < MIN_AFFORDABLE_POOL
    ) {
      this.logger.warn(
        `Budget rate cap (${maxRate}) matched only ${profiles.length} freelancers for project ${project.id}; relaxing.`,
      );
      profiles = await qb.take(poolCap).getMany();
    }

    // Dense retrieval signal: cosine of the brief embedding vs. each freelancer
    // profile embedding (pgvector). Best-effort — if it fails, matching still
    // works on lexical + structured signals.
    const similarity = await this.computeBriefSimilarity(
      brief,
      profiles.map((profile) => profile.id),
    );

    const candidates: MatchCandidateInputDto[] = profiles.map((profile) => {
      const scores = (profile.skillScores ?? []).map((entry) => ({
        skill: entry.skill,
        score: Number(entry.score),
      }));
      const averageSkillScore = scores.length
        ? Number(
            (
              scores.reduce((sum, entry) => sum + entry.score, 0) /
              scores.length
            ).toFixed(2),
          )
        : null;

      return {
        freelancerProfileId: profile.id,
        name: this.fullName(profile.user) ?? undefined,
        headline: profile.headline ?? undefined,
        profileSummary: profile.bio ?? undefined,
        skills: profile.skills ?? [],
        skillScores: scores,
        hourlyRate:
          profile.hourlyRate != null ? Number(profile.hourlyRate) : null,
        availabilityHours: profile.availabilityHoursPerWeek ?? null,
        yearsExperience: profile.yearsExperience ?? null,
        averageSkillScore,
        embeddingSimilarity: similarity.get(profile.id) ?? null,
      };
    });

    return { candidates };
  }

  /**
   * Cosine similarity of the brief embedding vs. each freelancer profile
   * embedding, via pgvector. Returns an empty map (lexical-only fallback) if the
   * brief has no text, the embedding call fails, or no profile has an embedding.
   */
  private async computeBriefSimilarity(
    brief: Brief | null,
    profileIds: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!brief || !profileIds.length) return map;

    const text = [brief.summary, brief.briefText]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join('\n')
      .trim();
    if (!text) return map;

    try {
      const result = await this.aiService.generateEmbedding({
        text,
        dimensions: 1024,
      });
      const embedding = result.embedding;
      if (!embedding?.length) return map;

      const vectorLiteral = `[${embedding.join(',')}]`;
      const rows = await this.dataSource.query<
        { freelancer_profile_id: string; similarity: string }[]
      >(
        `SELECT DISTINCT ON (freelancer_profile_id)
                freelancer_profile_id,
                1 - (embedding <=> $1::vector) AS similarity
         FROM freelancer_profile_embeddings
         WHERE freelancer_profile_id = ANY($2::uuid[])
         ORDER BY freelancer_profile_id, created_at DESC`,
        [vectorLiteral, profileIds],
      );

      for (const row of rows) {
        map.set(row.freelancer_profile_id, Number(row.similarity));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Brief similarity unavailable; matching falls back to lexical relevance: ${message}`,
      );
    }
    return map;
  }

  private buildProjectSnapshot(
    project: Project,
    dto: StartPlanningMatchingDto,
  ) {
    return {
      id: project.id,
      title: project.title,
      description: project.description,
      status: project.status,
      budgetMin: Number(project.budgetMin),
      budgetMax: Number(project.budgetMax),
      currency: project.currency,
      deadline: project.deadline?.toISOString() ?? null,
      isDeadlineFlexible: project.isDeadlineFlexible,
      requiredSkills: dto.filters?.skills ?? [],
    };
  }

  private buildBriefSnapshot(brief: Brief | null) {
    if (!brief) return null;
    return {
      id: brief.id,
      summary: brief.summary,
      briefText: brief.briefText,
      requiredSkills: brief.requiredSkills,
      technical: brief.technical,
    };
  }

  private async getProject(projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private async getCandidateCounts(runIds: string[]) {
    const counts = new Map<string, number>();
    if (!runIds.length) return counts;

    const rows = await this.candidateRepo
      .createQueryBuilder('c')
      .select('c.matching_run_id', 'runId')
      .addSelect('COUNT(*)', 'count')
      .where('c.matching_run_id IN (:...runIds)', { runIds })
      .groupBy('c.matching_run_id')
      .getRawMany<{ runId: string; count: string }>();

    for (const row of rows) counts.set(row.runId, Number(row.count));
    return counts;
  }

  private async getSelectedCandidateIds(runIds: string[]) {
    const selected = new Map<string, string>();
    if (!runIds.length) return selected;

    const rows = await this.candidateRepo.find({
      where: runIds.map((runId) => ({ matchingRunId: runId })),
    });
    for (const row of rows) {
      if (row.status === 'selected' || row.status === 'assigned') {
        selected.set(row.matchingRunId, row.id);
      }
    }
    return selected;
  }

  private buildFreelancerSummary(profile: FreelancerProfile | null) {
    if (!profile) return null;
    return {
      id: profile.id,
      name: this.fullName(profile.user),
      email: profile.user?.email ?? null,
      headline: profile.headline,
      hourlyRate:
        profile.hourlyRate != null ? Number(profile.hourlyRate) : null,
      availabilityHours: profile.availabilityHoursPerWeek,
      yearsExperience: profile.yearsExperience,
      topSkills: profile.skills ?? [],
    };
  }

  private fullName(user?: { firstName?: string; lastName?: string } | null) {
    if (!user) return null;
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  }

  private errorMessage(error: unknown) {
    if (error instanceof ForbiddenException) throw error;
    return error instanceof Error ? error.message : String(error);
  }
}
