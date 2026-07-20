import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { Project } from 'src/projects/entities/project.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { FreelancerAssessment } from 'src/freelancers/entities/freelancer-assessment.entity';
import { FreelancerAssessmentQuestion } from 'src/freelancers/entities/freelancer-assessment-question.entity';
import { FreelancerAssessmentAnswer } from 'src/freelancers/entities/freelancer-assessment-answer.entity';
import { FreelancerAssessmentEvent } from 'src/freelancers/entities/freelancer-assessment-event.entity';
import { FreelancerSkillScore } from 'src/freelancers/entities/freelancer-skill-score.entity';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { RefreshToken } from 'src/auth/entities/refresh-token.entity';
import { UserRole } from 'src/common/enums/user-role.enum';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AiJobRecoveryService } from 'src/queues/ai-job-recovery.service';
import { UpdateAdminUserDto } from './dtos/update-admin-user.dto';
import { UpdateAssessmentScoreDto } from './dtos/update-assessment-score.dto';
import { UpdateAssessmentAnswerScoreDto } from './dtos/update-assessment-answer-score.dto';
import { UpdateFreelancerSkillScoreDto } from './dtos/update-freelancer-skill-score.dto';

@Injectable()
export class AdminService {
  private readonly agentTypes = [
    'requirements',
    'cv_extraction',
    'assessment_generation',
    'assessment_grading',
    'matching',
    'project_plan_generation',
    'evaluation',
  ];
  private readonly warningEventTypes = [
    'fullscreen_exit',
    'visibility_hidden',
    'copy_attempt',
    'paste_attempt',
  ];
  private readonly adminReviewableAssessmentStatuses = new Set([
    'submitted',
    'needs_review',
    'passed',
    'failed',
    'expired',
    'cancelled',
  ]);

  constructor(
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectRepository(Project) private projectRepository: Repository<Project>,
    @InjectRepository(FreelancerProfile)
    private freelancerProfileRepository: Repository<FreelancerProfile>,
    @InjectRepository(FreelancerAssessment)
    private assessmentRepository: Repository<FreelancerAssessment>,
    @InjectRepository(FreelancerAssessmentQuestion)
    private questionRepository: Repository<FreelancerAssessmentQuestion>,
    @InjectRepository(FreelancerAssessmentAnswer)
    private answerRepository: Repository<FreelancerAssessmentAnswer>,
    @InjectRepository(FreelancerAssessmentEvent)
    private eventRepository: Repository<FreelancerAssessmentEvent>,
    @InjectRepository(FreelancerSkillScore)
    private skillScoreRepository: Repository<FreelancerSkillScore>,
    @InjectRepository(AgentJob)
    private agentJobRepository: Repository<AgentJob>,
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
    private readonly notificationsService: NotificationsService,
    private readonly aiJobRecoveryService: AiJobRecoveryService,
  ) {}

  private getAiRecommendation(feedback: Record<string, unknown> | null) {
    const value =
      feedback?.adminDecision ?? feedback?.recommendation ?? feedback?.decision;
    return typeof value === 'string' ? value : null;
  }

  private getProfileSummary(summary: Record<string, unknown> | null) {
    const value = summary?.profileSummary;
    return typeof value === 'string' ? value : null;
  }

  private async getWarningCounts(assessmentIds: string[]) {
    if (assessmentIds.length === 0) return new Map<string, number>();

    const rows = await this.eventRepository
      .createQueryBuilder('event')
      .select('event.assessmentId', 'assessmentId')
      .addSelect('COUNT(*)', 'count')
      .where('event.assessmentId IN (:...assessmentIds)', { assessmentIds })
      .andWhere('event.eventType IN (:...eventTypes)', {
        eventTypes: this.warningEventTypes,
      })
      .groupBy('event.assessmentId')
      .getRawMany<{ assessmentId: string; count: string }>();

    return new Map(
      rows.map((row) => [row.assessmentId, parseInt(row.count, 10)]),
    );
  }

  private toSkillScoreDto(score: FreelancerSkillScore) {
    return {
      id: score.id,
      skill: score.skill,
      score: score.score,
      confidence: score.confidence,
      evidence: score.evidence,
      source: score.source,
      assessmentId: score.assessmentId,
      updatedAt: score.updatedAt,
    };
  }

  private appendAdminFeedback(
    feedback: Record<string, unknown> | null,
    key: string,
    value: Record<string, unknown>,
  ) {
    return {
      ...(feedback ?? {}),
      [key]: value,
    };
  }

  private getAgentHealthStatus(failedToday: number) {
    if (failedToday > 2) return 'failing';
    if (failedToday > 0) return 'degraded';
    return 'healthy';
  }

  private getTodayStart() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  private getAgentJobTarget(job: AgentJob) {
    if (job.taskId) return { targetType: 'task', targetId: job.taskId };
    if (job.briefId) return { targetType: 'brief', targetId: job.briefId };
    if (job.assessmentId) {
      return { targetType: 'assessment', targetId: job.assessmentId };
    }
    if (job.freelancerProfileId) {
      return {
        targetType: 'freelancer_profile',
        targetId: job.freelancerProfileId,
      };
    }
    if (job.submissionId) {
      return { targetType: 'submission', targetId: job.submissionId };
    }
    if (job.matchingRunId) {
      return { targetType: 'matching_run', targetId: job.matchingRunId };
    }
    if (job.projectId) {
      return { targetType: 'project', targetId: job.projectId };
    }
    if (job.userId) return { targetType: 'user', targetId: job.userId };
    return { targetType: null, targetId: null };
  }

  // ===== Users =====

  async getUsers(
    pageNum: number,
    limitNum: number,
    filters: { search?: string; role?: UserRole; status?: string } = {},
  ) {
    const query = this.userRepository
      .createQueryBuilder('user')
      .withDeleted()
      .orderBy('user.createdAt', 'DESC')
      .addOrderBy('user.id', 'DESC')
      .skip((pageNum - 1) * limitNum)
      .take(limitNum);

    if (filters.search) {
      query.andWhere(
        `(
          user.firstName ILIKE :search
          OR user.lastName ILIKE :search
          OR user.email::text ILIKE :search
          OR user.phoneNumber ILIKE :search
        )`,
        { search: `%${filters.search}%` },
      );
    }

    if (filters.role) {
      query.andWhere('user.role = :role', { role: filters.role });
    }

    if (filters.status === 'active') {
      query.andWhere('user.deletedAt IS NULL');
    } else if (filters.status === 'disabled') {
      query.andWhere('user.deletedAt IS NOT NULL');
    } else if (filters.status === 'email_pending') {
      query.andWhere('user.isEmailVerified = false');
      query.andWhere('user.deletedAt IS NULL');
    }

    const [users, total] = await query.getManyAndCount();
    return { users, total };
  }

  async updateUser(id: string, dto: UpdateAdminUserDto, adminUserId: string) {
    const user = await this.userRepository.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!user) throw new NotFoundException('User not found');

    if (dto.disabled === true && user.id === adminUserId) {
      throw new BadRequestException(
        'You cannot disable your own admin account',
      );
    }

    if (dto.firstName !== undefined) user.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) user.lastName = dto.lastName.trim();
    if (dto.email !== undefined) user.email = dto.email.trim().toLowerCase();
    if (dto.phoneNumber !== undefined) {
      user.phoneNumber = dto.phoneNumber?.trim() || null;
    }
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.isEmailVerified !== undefined) {
      user.isEmailVerified = dto.isEmailVerified;
    }
    if (dto.isIdVerified !== undefined) user.isIdVerified = dto.isIdVerified;

    if (dto.disabled === true && !user.deletedAt) {
      user.deletedAt = new Date();
      await this.refreshTokenRepository.delete({ userId: user.id });
    } else if (dto.disabled === false && user.deletedAt) {
      user.deletedAt = null;
    }

    return this.userRepository.save(user);
  }

  // ===== Projects =====

  async getProjects(pageNum: number, limitNum: number) {
    const [projects, total] = await this.projectRepository.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      relations: ['customer'],
      select: {
        id: true,
        title: true,
        description: true,
        budgetMin: true,
        budgetMax: true,
        currency: true,
        deadline: true,
        status: true,
        createdAt: true,
        customer: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
        },
      },
    });
    return { projects, total };
  }

  // ===== Stats =====

  async getStats() {
    const today = this.getTodayStart();

    const [
      totalUsers,
      customers,
      freelancers,
      admins,
      emailVerified,
      emailPending,
      totalProjects,
      projectStatusRows,
      freelancerStatuses,
      totalFreelancers,
      totalAssessments,
      inProgressAssessments,
      submittedAssessments,
      passedAssessments,
      failedAssessments,
      needsReviewAssessments,
      queuedAgents,
      runningAgents,
      completedToday,
      failedToday,
      agentFailuresToday,
    ] = await Promise.all([
      this.userRepository.count(),
      this.userRepository.count({ where: { role: UserRole.CUSTOMER } }),
      this.userRepository.count({ where: { role: UserRole.FREELANCER } }),
      this.userRepository.count({ where: { role: UserRole.ADMIN } }),
      this.userRepository.count({ where: { isEmailVerified: true } }),
      this.userRepository.count({ where: { isEmailVerified: false } }),
      this.projectRepository.count(),
      this.projectRepository
        .createQueryBuilder('project')
        .select('project.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('project.status')
        .getRawMany<{ status: ProjectStatus; count: string }>(),
      this.freelancerProfileRepository
        .createQueryBuilder('fp')
        .select('fp.verificationStatus', 'verificationStatus')
        .addSelect('COUNT(*)', 'count')
        .groupBy('fp.verificationStatus')
        .getRawMany<{ verificationStatus: string; count: string }>(),
      this.freelancerProfileRepository.count(),
      this.assessmentRepository.count(),
      this.assessmentRepository.count({ where: { status: 'in_progress' } }),
      this.assessmentRepository.count({ where: { status: 'submitted' } }),
      this.assessmentRepository.count({ where: { status: 'passed' } }),
      this.assessmentRepository.count({ where: { status: 'failed' } }),
      this.assessmentRepository.count({ where: { status: 'needs_review' } }),
      this.agentJobRepository.count({ where: { status: 'queued' } }),
      this.agentJobRepository.count({ where: { status: 'running' } }),
      this.agentJobRepository
        .createQueryBuilder('job')
        .where('job.status = :status', { status: 'completed' })
        .andWhere('job.completedAt >= :today', { today })
        .getCount(),
      this.agentJobRepository
        .createQueryBuilder('job')
        .where('job.status = :status', { status: 'failed' })
        .andWhere('job.failedAt >= :today', { today })
        .getCount(),
      this.agentJobRepository
        .createQueryBuilder('job')
        .select('job.jobType', 'jobType')
        .addSelect('COUNT(*)', 'count')
        .where('job.status = :status', { status: 'failed' })
        .andWhere('job.failedAt >= :today', { today })
        .andWhere('job.jobType IN (:...agentTypes)', {
          agentTypes: this.agentTypes,
        })
        .groupBy('job.jobType')
        .getRawMany<{ jobType: string; count: string }>(),
    ]);

    const failuresByAgent = new Map(
      agentFailuresToday.map((row) => [row.jobType, parseInt(row.count, 10)]),
    );
    const agentHealth = this.agentTypes.reduce(
      (totals, agentType) => {
        const status = this.getAgentHealthStatus(
          failuresByAgent.get(agentType) ?? 0,
        );
        if (status === 'failing') totals.failing += 1;
        if (status === 'healthy') totals.healthy += 1;
        return totals;
      },
      { healthy: 0, failing: 0 },
    );

    const userStats = {
      total: totalUsers,
      customers,
      freelancers,
      admins,
      emailVerified,
      emailPending,
    };

    const projectStatusCounts = Object.values(ProjectStatus).reduce(
      (counts, status) => {
        counts[status] = 0;
        return counts;
      },
      {} as Record<ProjectStatus, number>,
    );

    projectStatusRows.forEach((row) => {
      projectStatusCounts[row.status] = parseInt(row.count, 10) || 0;
    });

    const projectStats = {
      total: totalProjects,
      draft: projectStatusCounts[ProjectStatus.DRAFT],
      inProgress: projectStatusCounts[ProjectStatus.IN_PROGRESS],
      briefComplete: projectStatusCounts[ProjectStatus.BRIEF_COMPLETE],
      planningMatching: projectStatusCounts[ProjectStatus.PLANNING_MATCHING],
      planningAssigned: projectStatusCounts[ProjectStatus.PLANNING_ASSIGNED],
      planningInProgress:
        projectStatusCounts[ProjectStatus.PLANNING_IN_PROGRESS],
      planningReview: projectStatusCounts[ProjectStatus.PLANNING_REVIEW],
      implementationReady:
        projectStatusCounts[ProjectStatus.IMPLEMENTATION_READY],
      matching: projectStatusCounts[ProjectStatus.MATCHING],
      matched: projectStatusCounts[ProjectStatus.MATCHED],
      specInProgress: projectStatusCounts[ProjectStatus.SPEC_IN_PROGRESS],
      specUnderReview: projectStatusCounts[ProjectStatus.SPEC_UNDER_REVIEW],
      specComplete: projectStatusCounts[ProjectStatus.SPEC_COMPLETE],
      scoped: projectStatusCounts[ProjectStatus.SCOPED],
      assigned: projectStatusCounts[ProjectStatus.ASSIGNED],
      active: projectStatusCounts[ProjectStatus.ACTIVE],
      underReview: projectStatusCounts[ProjectStatus.UNDER_REVIEW],
      completed: projectStatusCounts[ProjectStatus.COMPLETED],
      cancelled: projectStatusCounts[ProjectStatus.CANCELLED],
      disputed: projectStatusCounts[ProjectStatus.DISPUTED],
      byStatus: projectStatusCounts,
    };

    const freelancerStats = {
      total: totalFreelancers,
      profileIncomplete: 0,
      cvPending: 0,
      cvProcessing: 0,
      cvExtractionFailed: 0,
      assessmentPending: 0,
      assessmentGenerationFailed: 0,
      assessmentInProgress: 0,
      assessmentSubmitted: 0,
      interviewPending: 0,
      approved: 0,
      rejected: 0,
    };

    freelancerStatuses.forEach((row) => {
      const key = row.verificationStatus;
      const count = parseInt(row.count, 10);
      if (key === 'profile_incomplete')
        freelancerStats.profileIncomplete = count;
      else if (key === 'cv_pending') freelancerStats.cvPending = count;
      else if (key === 'cv_processing') freelancerStats.cvProcessing = count;
      else if (key === 'cv_extraction_failed')
        freelancerStats.cvExtractionFailed = count;
      else if (key === 'assessment_pending')
        freelancerStats.assessmentPending = count;
      else if (key === 'assessment_generation_failed')
        freelancerStats.assessmentGenerationFailed = count;
      else if (key === 'assessment_in_progress')
        freelancerStats.assessmentInProgress = count;
      else if (key === 'assessment_submitted')
        freelancerStats.assessmentSubmitted = count;
      else if (key === 'interview_pending')
        freelancerStats.interviewPending = count;
      else if (key === 'approved') freelancerStats.approved = count;
      else if (key === 'rejected') freelancerStats.rejected = count;
    });

    const assessmentStats = {
      total: totalAssessments,
      inProgress: inProgressAssessments,
      submitted: submittedAssessments,
      passed: passedAssessments,
      failed: failedAssessments,
      needsReview: needsReviewAssessments,
    };

    const agentTotals = {
      queued: queuedAgents,
      running: runningAgents,
      completedToday,
      failedToday,
      healthy: agentHealth.healthy,
      failing: agentHealth.failing,
    };

    return {
      users: userStats,
      projects: projectStats,
      freelancers: freelancerStats,
      assessments: assessmentStats,
      agents: agentTotals,
    };
  }

  // ===== Freelancer Queue =====

  async getFreelancers(
    pageNum: number,
    limitNum: number,
    status?: string,
    search?: string,
    skills?: string[],
    dateFrom?: string,
    dateTo?: string,
  ) {
    const query = this.freelancerProfileRepository
      .createQueryBuilder('fp')
      .leftJoinAndSelect('fp.user', 'user')
      .orderBy('fp.createdAt', 'DESC')
      .skip((pageNum - 1) * limitNum)
      .take(limitNum);

    if (status) {
      query.andWhere('fp.verificationStatus = :status', { status });
    }
    if (search) {
      query.andWhere(
        '(user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.email ILIKE :search)',
        { search: `%${search}%` },
      );
    }
    if (skills && skills.length > 0) {
      query.andWhere('fp.skills && :skills', { skills });
    }
    if (dateFrom) {
      query.andWhere('fp.assessmentSubmittedAt >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      query.andWhere('fp.assessmentSubmittedAt <= :dateTo', { dateTo });
    }

    const [profiles, total] = await query.getManyAndCount();
    const profileIds = profiles.map((profile) => profile.id);
    const skillScores =
      profileIds.length > 0
        ? await this.skillScoreRepository.find({
            where: { freelancerProfileId: In(profileIds) },
            order: { score: 'DESC', skill: 'ASC' },
          })
        : [];
    const topSkillScoresByProfile = skillScores.reduce((map, score) => {
      const existing = map.get(score.freelancerProfileId) ?? [];
      if (existing.length < 5) {
        existing.push(this.toSkillScoreDto(score));
        map.set(score.freelancerProfileId, existing);
      }
      return map;
    }, new Map<string, ReturnType<typeof this.toSkillScoreDto>[]>());

    const data = profiles.map((profile) => ({
      id: profile.id,
      userId: profile.user.id,
      name: `${profile.user.firstName} ${profile.user.lastName}`,
      email: profile.user.email,
      headline: profile.headline,
      skills: profile.skills,
      yearsExperience: profile.yearsExperience,
      cvUrl: profile.cvUrl,
      verificationStatus: profile.verificationStatus,
      assessmentScore: profile.assessmentScore,
      assessmentSubmittedAt: profile.assessmentSubmittedAt,
      approvedAt: profile.approvedAt,
      rejectedAt: profile.rejectedAt,
      aiProfileSummary: this.getProfileSummary(profile.summary),
      topSkillScores: topSkillScoresByProfile.get(profile.id) ?? [],
      createdAt: profile.createdAt,
    }));

    return { data, total };
  }

  async getFreelancerDetail(id: string) {
    const profile = await this.freelancerProfileRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!profile) {
      throw new NotFoundException('Freelancer profile not found');
    }

    const assessment = await this.assessmentRepository.findOne({
      where: { freelancerProfileId: id },
      order: { createdAt: 'DESC' },
    });
    const skillScores = await this.skillScoreRepository.find({
      where: { freelancerProfileId: id },
      order: { score: 'DESC', skill: 'ASC' },
    });

    let questions: FreelancerAssessmentQuestion[] = [];
    let answers: FreelancerAssessmentAnswer[] = [];
    let warningCount = 0;
    if (assessment) {
      questions = await this.questionRepository.find({
        where: { assessmentId: assessment.id },
        order: { orderIndex: 'ASC' },
      });
      answers = await this.answerRepository.find({
        where: { assessmentId: assessment.id },
      });
      warningCount =
        (await this.getWarningCounts([assessment.id])).get(assessment.id) ?? 0;
    }
    const answersByQuestionId = new Map(
      answers.map((answer) => [answer.questionId, answer]),
    );

    return {
      profile: {
        id: profile.id,
        userId: profile.user.id,
        name: `${profile.user.firstName} ${profile.user.lastName}`,
        email: profile.user.email,
        headline: profile.headline,
        bio: profile.bio,
        skills: profile.skills,
        yearsExperience: profile.yearsExperience,
        hourlyRate: profile.hourlyRate,
        availabilityHoursPerWeek: profile.availabilityHoursPerWeek,
        isAvailable: profile.isAvailable,
        cvUrl: profile.cvUrl,
        verificationStatus: profile.verificationStatus,
        assessmentScore: profile.assessmentScore,
        assessmentSubmittedAt: profile.assessmentSubmittedAt,
        approvedAt: profile.approvedAt,
        rejectedAt: profile.rejectedAt,
        rejectionReason: profile.rejectionReason,
        summary: profile.summary,
        aiProfileSummary: this.getProfileSummary(profile.summary),
        skillScores: skillScores.map((score) => this.toSkillScoreDto(score)),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      assessment: assessment
        ? {
            id: assessment.id,
            status: assessment.status,
            score: assessment.score,
            recommendation: this.getAiRecommendation(assessment.aiFeedback),
            aiFeedback: assessment.aiFeedback,
            warningCount,
            submittedAt: assessment.submittedAt,
            startedAt: assessment.startedAt,
            expiresAt: assessment.expiresAt,
            questions: questions.map((question) => {
              const answer = answersByQuestionId.get(question.id);
              return {
                id: question.id,
                type: question.questionType,
                skill: question.skill,
                prompt: question.prompt,
                orderIndex: question.orderIndex,
                answer: answer?.answer ?? null,
                score: answer?.score ?? null,
                feedback: answer?.feedback ?? null,
              };
            }),
            answers,
          }
        : null,
    };
  }

  async updateFreelancerVerification(
    id: string,
    payload: { status: string; reason?: string },
    adminUserId?: string,
  ) {
    const profile = await this.freelancerProfileRepository.findOne({
      where: { id },
    });

    if (!profile) {
      throw new NotFoundException('Freelancer profile not found');
    }

    profile.verificationStatus = payload.status;
    if (payload.status === 'approved') {
      profile.approvedAt = new Date();
      profile.rejectedAt = null;
      profile.rejectionReason = null;
    } else if (payload.status === 'rejected') {
      profile.rejectedAt = new Date();
      profile.rejectionReason = payload.reason || 'No reason provided';
      profile.approvedAt = null;
    }

    await this.freelancerProfileRepository.save(profile);

    await this.notificationsService.createNotification({
      userId: profile.userId,
      title:
        payload.status === 'approved'
          ? 'Verification approved'
          : payload.status === 'rejected'
            ? 'Verification update'
            : 'Verification status updated',
      body:
        payload.status === 'approved'
          ? 'Your freelancer verification was approved. You can now receive matched work.'
          : payload.status === 'rejected'
            ? `Your freelancer verification was not approved. ${profile.rejectionReason ?? ''}`.trim()
            : `Your verification status changed to ${payload.status}.`,
    });

    profile.summary = this.appendAdminFeedback(
      profile.summary,
      'lastAdminVerificationUpdate',
      {
        status: payload.status,
        reason: payload.reason ?? null,
        adminUserId: adminUserId ?? null,
        updatedAt: new Date().toISOString(),
      },
    );
    await this.freelancerProfileRepository.save(profile);

    return profile;
  }

  async updateFreelancerSkillScore(
    profileId: string,
    skillScoreId: string,
    dto: UpdateFreelancerSkillScoreDto,
    adminUserId: string,
  ) {
    const skillScore = await this.skillScoreRepository.findOne({
      where: { id: skillScoreId, freelancerProfileId: profileId },
    });
    if (!skillScore) throw new NotFoundException('Skill score not found');

    skillScore.score = dto.score.toFixed(2);
    if (dto.confidence !== undefined) {
      skillScore.confidence = dto.confidence.toFixed(2);
    }
    if (dto.evidence !== undefined) {
      skillScore.evidence = dto.evidence;
    }
    skillScore.source = 'admin_override';
    await this.skillScoreRepository.save(skillScore);

    const profile = await this.freelancerProfileRepository.findOne({
      where: { id: profileId },
    });
    if (profile) {
      profile.summary = this.appendAdminFeedback(
        profile.summary,
        'lastAdminSkillScoreUpdate',
        {
          skillScoreId,
          skill: skillScore.skill,
          score: skillScore.score,
          confidence: skillScore.confidence,
          adminUserId,
          updatedAt: new Date().toISOString(),
        },
      );
      await this.freelancerProfileRepository.save(profile);
    }

    return this.getFreelancerDetail(profileId);
  }

  // ===== Assessment Review =====

  async getAssessments(
    pageNum: number,
    limitNum: number,
    status?: string,
    search?: string,
    dateFrom?: string,
    dateTo?: string,
    minScore?: number,
    maxScore?: number,
  ) {
    const query = this.assessmentRepository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.freelancerProfile', 'fp')
      .leftJoinAndSelect('fp.user', 'user')
      .orderBy('a.submittedAt', 'DESC')
      .skip((pageNum - 1) * limitNum)
      .take(limitNum);

    if (status) {
      query.andWhere('a.status = :status', { status });
    }
    if (search) {
      query.andWhere(
        '(user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.email ILIKE :search)',
        { search: `%${search}%` },
      );
    }
    if (dateFrom) {
      query.andWhere('a.submittedAt >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      query.andWhere('a.submittedAt <= :dateTo', { dateTo });
    }
    if (minScore !== undefined && minScore !== null) {
      query.andWhere('a.score >= :minScore', { minScore });
    }
    if (maxScore !== undefined && maxScore !== null) {
      query.andWhere('a.score <= :maxScore', { maxScore });
    }

    const [assessments, total] = await query.getManyAndCount();
    const warningCounts = await this.getWarningCounts(
      assessments.map((assessment) => assessment.id),
    );

    const data = assessments.map((a) => ({
      id: a.id,
      freelancerProfileId: a.freelancerProfileId,
      freelancerName: `${a.freelancerProfile.user.firstName} ${a.freelancerProfile.user.lastName}`,
      freelancerEmail: a.freelancerProfile.user.email,
      score: a.score,
      status: a.status,
      recommendation: this.getAiRecommendation(a.aiFeedback),
      profileSummary: this.getProfileSummary(a.freelancerProfile.summary),
      warningCount: warningCounts.get(a.id) ?? 0,
      submittedAt: a.submittedAt,
      startedAt: a.startedAt,
    }));

    return { data, total };
  }

  async getAssessmentDetail(id: string) {
    const assessment = await this.assessmentRepository.findOne({
      where: { id },
      relations: ['freelancerProfile', 'freelancerProfile.user'],
    });

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    const questions = await this.questionRepository.find({
      where: { assessmentId: id },
      order: { orderIndex: 'ASC' },
    });

    const answers = await this.answerRepository.find({
      where: { assessmentId: id },
    });

    const events = await this.eventRepository.find({
      where: { assessmentId: id },
    });
    const skillScores = await this.skillScoreRepository.find({
      where: { freelancerProfileId: assessment.freelancerProfile.id },
      order: { score: 'DESC', skill: 'ASC' },
    });

    const eventSummary = {
      total: events.length,
      warningCount: events.filter((e) =>
        this.warningEventTypes.includes(e.eventType),
      ).length,
      focusLost: events.filter((e) => e.eventType === 'focus_lost').length,
      fullscreenExit: events.filter((e) => e.eventType === 'fullscreen_exit')
        .length,
    };
    const answersByQuestionId = new Map(
      answers.map((answer) => [answer.questionId, answer]),
    );

    return {
      id: assessment.id,
      freelancer: {
        id: assessment.freelancerProfile.id,
        name: `${assessment.freelancerProfile.user.firstName} ${assessment.freelancerProfile.user.lastName}`,
        email: assessment.freelancerProfile.user.email,
        headline: assessment.freelancerProfile.headline,
        cvUrl: assessment.freelancerProfile.cvUrl,
        verificationStatus: assessment.freelancerProfile.verificationStatus,
      },
      status: assessment.status,
      score: assessment.score,
      recommendation: this.getAiRecommendation(assessment.aiFeedback),
      aiFeedback: assessment.aiFeedback,
      profileSummary: this.getProfileSummary(
        assessment.freelancerProfile.summary,
      ),
      skillScores: skillScores.map((score) => this.toSkillScoreDto(score)),
      submittedAt: assessment.submittedAt,
      startedAt: assessment.startedAt,
      expiresAt: assessment.expiresAt,
      questions: questions.map((q) => {
        const ans = answersByQuestionId.get(q.id);
        return {
          id: q.id,
          type: q.questionType,
          skill: q.skill,
          prompt: q.prompt,
          orderIndex: q.orderIndex,
          answer: ans?.answer ?? null,
          score: ans?.score ?? null,
          feedback: ans?.feedback ?? null,
        };
      }),
      events: events
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((event) => ({
          id: event.id,
          eventType: event.eventType,
          metadata: event.metadata,
          isWarning: this.warningEventTypes.includes(event.eventType),
          createdAt: event.createdAt,
        })),
      eventsSummary: eventSummary,
    };
  }

  async updateAssessmentScore(
    id: string,
    dto: UpdateAssessmentScoreDto,
    adminUserId: string,
  ) {
    const assessment = await this.assessmentRepository.findOne({
      where: { id },
      relations: ['freelancerProfile'],
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    assessment.score = dto.score.toFixed(2);
    assessment.aiFeedback = this.appendAdminFeedback(
      assessment.aiFeedback,
      'lastAdminScoreOverride',
      {
        score: assessment.score,
        notes: dto.notes ?? null,
        adminUserId,
        updatedAt: new Date().toISOString(),
      },
    );
    await this.assessmentRepository.save(assessment);

    if (assessment.freelancerProfile) {
      assessment.freelancerProfile.assessmentScore = assessment.score;
      await this.freelancerProfileRepository.save(assessment.freelancerProfile);
    }

    return this.getAssessmentDetail(id);
  }

  async updateAssessmentAnswerScore(
    id: string,
    questionId: string,
    dto: UpdateAssessmentAnswerScoreDto,
    adminUserId: string,
  ) {
    const assessment = await this.assessmentRepository.findOne({
      where: { id },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    const answer = await this.answerRepository.findOne({
      where: { assessmentId: id, questionId },
    });
    if (!answer) {
      throw new NotFoundException('No saved answer exists for this question');
    }

    answer.score = dto.score.toFixed(2);
    if (dto.feedback !== undefined) {
      answer.feedback = dto.feedback;
    }
    await this.answerRepository.save(answer);

    assessment.aiFeedback = this.appendAdminFeedback(
      assessment.aiFeedback,
      'lastAdminAnswerScoreOverride',
      {
        questionId,
        score: answer.score,
        feedback: answer.feedback,
        adminUserId,
        updatedAt: new Date().toISOString(),
      },
    );
    await this.assessmentRepository.save(assessment);

    return this.getAssessmentDetail(id);
  }

  async reviewAssessment(
    id: string,
    payload: {
      decision: 'pass' | 'fail' | 'needs_review';
      notes?: string;
      scoreOverride?: number;
    },
    adminUserId?: string,
  ) {
    const assessment = await this.assessmentRepository.findOne({
      where: { id },
      relations: ['freelancerProfile'],
    });

    if (!assessment) {
      throw new NotFoundException('Assessment not found');
    }

    if (!this.adminReviewableAssessmentStatuses.has(assessment.status)) {
      throw new BadRequestException(
        'Assessment is not ready for admin review yet',
      );
    }

    // Update assessment
    assessment.status =
      payload.decision === 'pass'
        ? 'passed'
        : payload.decision === 'fail'
          ? 'failed'
          : 'needs_review';
    if (payload.scoreOverride !== undefined && payload.scoreOverride !== null) {
      assessment.score = payload.scoreOverride.toFixed(2);
    }

    // Store decision and notes in aiFeedback
    assessment.aiFeedback = {
      ...(assessment.aiFeedback || {}),
      decision: payload.decision,
      notes: payload.notes,
      reviewedBy: adminUserId ?? null,
      reviewedAt: new Date(),
    };

    await this.assessmentRepository.save(assessment);

    const profile = assessment.freelancerProfile;

    // Update freelancer verification status based on decision. Admin decisions
    // are authoritative and can override an AI pass/fail recommendation.
    if (payload.decision === 'pass') {
      profile.verificationStatus = 'approved';
      profile.approvedAt = new Date();
      profile.rejectedAt = null;
      profile.rejectionReason = null;
    } else if (payload.decision === 'fail') {
      profile.verificationStatus = 'rejected';
      profile.rejectedAt = new Date();
      profile.rejectionReason = payload.notes || 'Assessment failed review';
      profile.approvedAt = null;
    } else {
      profile.verificationStatus = 'assessment_submitted';
      profile.approvedAt = null;
      profile.rejectedAt = null;
      profile.rejectionReason = null;
    }

    if (assessment.score !== null) {
      profile.assessmentScore = assessment.score;
    }
    await this.freelancerProfileRepository.save(profile);

    await this.notificationsService.createNotification({
      userId: assessment.freelancerProfile.userId,
      title:
        payload.decision === 'pass'
          ? 'Assessment approved'
          : payload.decision === 'fail'
            ? 'Assessment reviewed'
            : 'Assessment needs review',
      body:
        payload.decision === 'pass'
          ? 'Your assessment was approved. Your profile is now ready for matching.'
          : payload.decision === 'fail'
            ? payload.notes || 'Your assessment was not approved after review.'
            : payload.notes ||
              'Your assessment needs another review before verification can continue.',
    });

    return { id: assessment.id, status: assessment.status };
  }

  // ===== Agent Overview =====

  async getAgentOverview() {
    const today = this.getTodayStart();

    const agents = await Promise.all(
      this.agentTypes.map(async (name) => {
        const [
          queued,
          running,
          completedToday,
          failedToday,
          lastSuccess,
          lastFailure,
        ] = await Promise.all([
          this.agentJobRepository.count({
            where: { jobType: name, status: 'queued' },
          }),
          this.agentJobRepository.count({
            where: { jobType: name, status: 'running' },
          }),
          this.agentJobRepository
            .createQueryBuilder('job')
            .where('job.jobType = :jobType', { jobType: name })
            .andWhere('job.status = :status', { status: 'completed' })
            .andWhere('job.completedAt >= :today', { today })
            .getCount(),
          this.agentJobRepository
            .createQueryBuilder('job')
            .where('job.jobType = :jobType', { jobType: name })
            .andWhere('job.status = :status', { status: 'failed' })
            .andWhere('job.failedAt >= :today', { today })
            .getCount(),
          this.agentJobRepository.findOne({
            where: { jobType: name, status: 'completed' },
            order: { completedAt: 'DESC' },
            select: ['completedAt'],
          }),
          this.agentJobRepository.findOne({
            where: { jobType: name, status: 'failed' },
            order: { failedAt: 'DESC' },
            select: ['failedAt'],
          }),
        ]);

        const health = this.getAgentHealthStatus(failedToday);

        return {
          name,
          status: health,
          queued,
          running,
          completedToday,
          failedToday,
          lastSuccessAt: lastSuccess?.completedAt ?? null,
          lastFailureAt: lastFailure?.failedAt ?? null,
        };
      }),
    );

    const healthTotals = agents.reduce(
      (totals, agent) => {
        if (agent.status === 'healthy') totals.healthy += 1;
        if (agent.status === 'failing') totals.failing += 1;
        return totals;
      },
      { healthy: 0, failing: 0 },
    );

    const totals = {
      queued: await this.agentJobRepository.count({
        where: { status: 'queued' },
      }),
      running: await this.agentJobRepository.count({
        where: { status: 'running' },
      }),
      completedToday: await this.agentJobRepository
        .createQueryBuilder('job')
        .where('job.status = :status', { status: 'completed' })
        .andWhere('job.completedAt >= :today', { today })
        .getCount(),
      failedToday: await this.agentJobRepository
        .createQueryBuilder('job')
        .where('job.status = :status', { status: 'failed' })
        .andWhere('job.failedAt >= :today', { today })
        .getCount(),
      healthy: healthTotals.healthy,
      failing: healthTotals.failing,
    };

    return { agents, totals };
  }

  // ===== Agent Jobs =====

  async getAgentJobs(
    pageNum: number,
    limitNum: number,
    status?: string,
    jobType?: string,
  ) {
    const query = this.agentJobRepository
      .createQueryBuilder('job')
      .orderBy('job.createdAt', 'DESC')
      .skip((pageNum - 1) * limitNum)
      .take(limitNum);

    if (status) {
      query.where('job.status = :status', { status });
    }
    if (jobType) {
      query.andWhere('job.jobType = :jobType', { jobType });
    }

    const [jobs, total] = await query.getManyAndCount();

    const data = jobs.map((job) => ({
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      userId: job.userId,
      projectId: job.projectId,
      ...this.getAgentJobTarget(job),
      payload: job.input,
      result: job.output,
      error: job.error,
      attempts: job.attempts,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    }));

    return { data, total };
  }

  async getAgentJobDetail(id: string) {
    const job = await this.agentJobRepository.findOne({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException('Agent job not found');
    }

    return {
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      userId: job.userId,
      projectId: job.projectId,
      ...this.getAgentJobTarget(job),
      payload: job.input,
      result: job.output,
      error: job.error,
      attempts: job.attempts,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }

  async retryAgentJob(id: string) {
    await this.aiJobRecoveryService.retryFailedJobNow(id);
    return this.getAgentJobDetail(id);
  }
}
