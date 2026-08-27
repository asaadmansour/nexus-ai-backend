import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Not, Repository } from 'typeorm';
import { UserRole } from 'src/common/enums/user-role.enum';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectRepository } from 'src/projects/entities/project-repository.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { RepositoryCollaborator } from 'src/projects/entities/repository-collaborator.entity';
import { CreateRepositoryDto } from './dtos/create-repository.dto';
import {
  ResendInviteDto,
  SyncCollaboratorsDto,
} from './dtos/sync-collaborators.dto';
import { GithubService } from './github.service';
import { AutomationIncidentsService } from 'src/automation/automation-incidents.service';

type Requester = { userId: string; role: UserRole };

const DEFAULT_PERMISSION = 'push';
const ASSIGNMENT_ACTIVE_STATUSES = ['assigned', 'accepted', 'in_progress'];
// An invite in one of these states does not need to be sent again.
const SETTLED_INVITE_STATUSES = ['invited', 'accepted'];

@Injectable()
export class RepositoriesService {
  private readonly logger = new Logger(RepositoriesService.name);

  constructor(
    @InjectRepository(ProjectRepository)
    private readonly repoRepo: Repository<ProjectRepository>,
    @InjectRepository(RepositoryCollaborator)
    private readonly collaboratorRepo: Repository<RepositoryCollaborator>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectTask)
    private readonly taskRepo: Repository<ProjectTask>,
    @InjectRepository(ProjectRoleAssignment)
    private readonly assignmentRepo: Repository<ProjectRoleAssignment>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    private readonly github: GithubService,
    private readonly notificationsService: NotificationsService,
    private readonly incidents: AutomationIncidentsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Repository
  // ---------------------------------------------------------------------------

  // Idempotent by project: an existing non-archived repository is returned as
  // is, and a previously failed row is retried in place instead of duplicated.
  async createRepository(
    projectId: string,
    dto: CreateRepositoryDto,
    adminUserId: string | null,
  ) {
    const project = await this.getProject(projectId);
    const owner = dto.owner ?? this.github.owner;
    if (!owner) {
      throw new ServiceUnavailableException(
        'GitHub is not configured (GITHUB_OWNER is missing)',
      );
    }
    const repoName = dto.repoName ?? this.buildRepoName(project);
    const visibility = dto.visibility ?? this.github.defaultVisibility;

    // Claim provisioning in the database before calling GitHub. Previously two
    // acceptance/reconciliation paths could both see "no repository", both call
    // GitHub, and one would fail or create an unnecessary suffixed repository.
    // Locking the project makes the claim atomic across every backend instance.
    const claim = await this.repoRepo.manager.transaction(async (manager) => {
      await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', { projectId })
        .getOneOrFail();
      const repository = await manager.findOne(ProjectRepository, {
        where: { projectId, status: Not('archived') },
        order: { createdAt: 'DESC' },
      });
      if (repository?.status === 'active') {
        return { row: repository, provision: false, previousFailure: null };
      }
      const staleCreating =
        repository?.status === 'creating' &&
        repository.updatedAt.getTime() <= Date.now() - 5 * 60_000;
      if (repository?.status === 'creating' && !staleCreating) {
        return { row: repository, provision: false, previousFailure: null };
      }
      const row =
        repository ??
        manager.create(ProjectRepository, {
          projectId,
          provider: dto.provider ?? 'github',
          createdBy: adminUserId,
        });
      const previousFailure =
        typeof repository?.metadata?.error === 'string'
          ? repository.metadata.error
          : null;
      row.owner = owner;
      row.repoName = repoName;
      row.repoUrl = `https://github.com/${owner}/${repoName}`;
      row.defaultBranch = dto.defaultBranch ?? 'main';
      row.status = 'creating';
      row.metadata = {
        visibility,
        provisioningStartedAt: new Date().toISOString(),
      };
      return {
        row: await manager.save(ProjectRepository, row),
        provision: true,
        previousFailure,
      };
    });
    if (!claim.provision) {
      const settled =
        claim.row.status === 'creating'
          ? await this.waitForRepositoryProvisioning(claim.row.id)
          : claim.row;
      return this.toRepositoryResponse(settled);
    }
    const row = claim.row;

    let failure: string | null = null;
    let failureTrace: string | null = null;
    const previousFailure = claim.previousFailure;
    try {
      // If the name is somehow still taken — a leftover repo, or a caller-supplied
      // name — walk a suffix rather than dead-ending the project. ISSUES.md #3.
      let created: Awaited<
        ReturnType<typeof this.github.createRepository>
      > | null = null;
      let attemptName = repoName;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          // Recover a remote repository created by a previous process that died
          // before persisting GitHub's response. This is the common "manual retry
          // works" race and avoids creating a second suffixed repository.
          created = await this.createOrRecoverRemoteRepository({
            owner,
            repoName: attemptName,
            visibility,
            description: dto.description ?? project.title,
          });
          break;
        } catch (createError) {
          if (!this.isNameTakenError(createError) || dto.repoName)
            throw createError;
          attemptName = this.buildRepoName(project, attempt + 1);
          this.logger.warn(
            `Repository name already taken for project ${projectId}; retrying as ${attemptName}`,
          );
        }
      }
      if (!created) {
        throw new Error(
          `Could not find an available repository name for project ${projectId}`,
        );
      }
      row.repoName = attemptName;
      row.externalId = created.externalId;
      row.repoUrl = created.repoUrl;
      row.defaultBranch = created.defaultBranch;
      row.status = 'active';
      row.lastSyncedAt = new Date();
      row.metadata = { visibility };
      // Publish the usable repository before optional webhook work. Otherwise
      // a concurrent assignment can wait on `creating` until the webhook HTTP
      // timeout even though GitHub already created the repository successfully.
      await this.repoRepo.save(row);
      await this.syncEvaluationWebhook(row);
    } catch (error) {
      // Never silently mock: keep the failure visible and retryable.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `GitHub repository creation failed for project ${projectId}: ${message}`,
      );
      row.status = 'failed';
      row.metadata = { visibility, error: message };
      failure = message;
      failureTrace = error instanceof Error ? (error.stack ?? null) : null;
    }
    const saved = await this.repoRepo.save(row);
    if (failure && failure !== previousFailure) {
      await this.notifyTechnicalIssue(
        projectId,
        'GitHub repository provisioning failed',
        failure,
        {
          operation: 'provision_project',
          errorCode: 'provisioning_failed',
          trace: failureTrace,
          context: { repositoryId: saved.id },
        },
      );
    }
    return this.toRepositoryResponse(saved);
  }

  private async syncEvaluationWebhook(repository: ProjectRepository) {
    const priorWebhook = repository.metadata?.evaluationWebhook as
      Record<string, unknown> | undefined;
    try {
      const webhook = await this.github.ensureEvaluationWebhook({
        owner: repository.owner,
        repoName: repository.repoName,
      });
      repository.metadata = {
        ...(repository.metadata ?? {}),
        evaluationWebhook: {
          status: webhook.active ? 'active' : 'inactive',
          id: webhook.id,
          url: webhook.url,
          syncedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `GitHub evaluation webhook sync failed for ${repository.owner}/${repository.repoName}: ${message}`,
      );
      repository.metadata = {
        ...(repository.metadata ?? {}),
        evaluationWebhook: {
          status: 'failed',
          error: message,
          syncedAt: new Date().toISOString(),
        },
      };
      if (
        priorWebhook?.status !== 'failed' ||
        priorWebhook?.error !== message
      ) {
        await this.notifyTechnicalIssue(
          repository.projectId,
          'GitHub evaluation webhook failed',
          message,
          {
            operation: 'sync_evaluation_webhook',
            errorCode: 'webhook_sync_failed',
            trace: error instanceof Error ? error.stack : undefined,
            context: { repositoryId: repository.id },
          },
        );
      }
    }
  }

  async syncProjectEvaluationWebhook(projectId: string) {
    const repository = await this.findProjectRepository(projectId);
    if (!repository) {
      throw new NotFoundException('This project has no repository yet');
    }
    if (repository.status !== 'active') {
      throw new BadRequestException(
        'The project repository must be active before its webhook can be synced',
      );
    }
    await this.syncEvaluationWebhook(repository);
    return this.toRepositoryResponse(await this.repoRepo.save(repository));
  }

  async getProjectRepository(projectId: string, requester: Requester) {
    const project = await this.getProject(projectId);
    await this.assertProjectVisibility(project, requester);

    const repository = await this.findProjectRepository(projectId);
    if (!repository) {
      throw new NotFoundException('This project has no repository yet');
    }

    const collaborators = await this.collaboratorRepo.find({
      where: { repositoryId: repository.id },
      relations: ['freelancerProfile', 'freelancerProfile.user'],
      order: { createdAt: 'ASC' },
    });

    return {
      repository: this.toRepositoryResponse(repository),
      collaborators: collaborators.map((row) =>
        this.toCollaboratorResponse(row),
      ),
    };
  }

  async adminList(query: {
    status?: string;
    projectId?: string;
    page: number;
    limit: number;
  }) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.projectId) where.projectId = query.projectId;

    const [rows, total] = await this.repoRepo.findAndCount({
      where,
      relations: ['project'],
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    const counts = await this.getCollaboratorCounts(rows.map((row) => row.id));
    const data = rows.map((row) => ({
      ...this.toRepositoryResponse(row),
      projectTitle: row.project?.title ?? null,
      collaboratorCount: counts.get(row.id)?.total ?? 0,
      missingUsernameCount: counts.get(row.id)?.missingUsername ?? 0,
    }));

    return { data, total };
  }

  // ---------------------------------------------------------------------------
  // Collaborators
  // ---------------------------------------------------------------------------

  async syncCollaborators(
    projectId: string,
    dto: SyncCollaboratorsDto,
    adminUserId: string | null,
  ) {
    const repository = await this.findProjectRepository(projectId);
    if (!repository) {
      throw new NotFoundException('This project has no repository yet');
    }
    if (repository.status !== 'active') {
      throw new BadRequestException(
        'The project repository is not active yet; create or retry it first',
      );
    }
    await this.syncEvaluationWebhook(repository);
    await this.repoRepo.save(repository);

    const permission = dto.permission ?? DEFAULT_PERMISSION;
    const profileIds = await this.resolveCollaboratorProfileIds(projectId, dto);
    if (!profileIds.length) {
      throw new BadRequestException(
        'No assigned freelancers were found to invite',
      );
    }

    const profiles = await this.profileRepo.find({
      where: { id: In(profileIds) },
      relations: ['user'],
    });

    let invited = 0;
    let missingUsername = 0;

    for (const profile of profiles) {
      // Claim/create the collaborator row while briefly locking the repository.
      // Multiple role acceptances can call this method together; without the
      // claim both callers could observe no row and one would fail the unique
      // index, making automatic provisioning appear to require a manual retry.
      const row = await this.claimCollaboratorRow(
        repository,
        projectId,
        profile.id,
      );
      row.permission = permission;

      // Already invited or accepted: return the current row, do not re-invite.
      if (row.id && SETTLED_INVITE_STATUSES.includes(row.inviteStatus)) {
        continue;
      }

      if (!profile.githubUsername) {
        const shouldNotify = row.inviteStatus !== 'missing_username';
        row.githubUsername = null;
        row.inviteStatus = 'missing_username';
        await this.collaboratorRepo.save(row);
        if (shouldNotify) {
          await this.notificationsService.createNotification({
            userId: profile.userId,
            projectId,
            type: 'github_action_required',
            title: 'Add your GitHub username',
            body: 'Your project assignment is active, but repository access cannot be sent until you add your GitHub username to your profile.',
            actionUrl: '/profile',
          });
        }
        missingUsername += 1;
        continue;
      }

      row.githubUsername = profile.githubUsername;
      const claimed = await this.collaboratorRepo
        .createQueryBuilder()
        .update(RepositoryCollaborator)
        .set({
          githubUsername: profile.githubUsername,
          permission,
          inviteStatus: 'sending',
        })
        .where('id = :id', { id: row.id })
        .andWhere("invite_status NOT IN ('sending', 'invited', 'accepted')")
        .execute();
      if (!claimed.affected) continue;
      row.inviteStatus = 'sending';
      await this.sendInvite(repository, row);
      if (row.inviteStatus === 'invited' || row.inviteStatus === 'accepted') {
        invited += 1;
        await this.notifyInvite(profile, repository);
      }
    }

    repository.lastSyncedAt = new Date();
    await this.repoRepo.save(repository);
    this.logger.log(
      `Repository ${repository.id} synced by ${adminUserId ?? 'system'}: ${invited} invited, ${missingUsername} missing username`,
    );

    const collaborators = await this.collaboratorRepo.find({
      where: { repositoryId: repository.id },
      relations: ['freelancerProfile', 'freelancerProfile.user'],
      order: { createdAt: 'ASC' },
    });

    return {
      repositoryId: repository.id,
      invited,
      missingUsername,
      collaborators: collaborators.map((row) =>
        this.toCollaboratorResponse(row),
      ),
    };
  }

  async resendInvite(collaboratorId: string, dto: ResendInviteDto) {
    const row = await this.collaboratorRepo.findOne({
      where: { id: collaboratorId },
      relations: ['repository', 'freelancerProfile', 'freelancerProfile.user'],
    });
    if (!row) throw new NotFoundException('Collaborator not found');

    // The freelancer may have added their username since the last attempt.
    const username =
      row.freelancerProfile?.githubUsername ?? row.githubUsername ?? null;
    if (!username) {
      row.inviteStatus = 'missing_username';
      await this.collaboratorRepo.save(row);
      throw new BadRequestException(
        'This freelancer has not saved a GitHub username yet',
      );
    }

    row.githubUsername = username;
    if (dto.permission) row.permission = dto.permission;
    await this.sendInvite(row.repository, row);
    return this.toCollaboratorResponse(row);
  }

  async provisionForAssignedTeam(projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
      select: {
        id: true,
        planningFundedAt: true,
        implementationFundedAt: true,
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.planningFundedAt && !project.implementationFundedAt) {
      throw new ConflictException(
        'Repository collaborator access starts only after the relevant escrow stage is funded',
      );
    }
    let repository = await this.findProjectRepository(projectId);
    if (!repository || repository.status === 'failed') {
      await this.createRepository(projectId, {}, null);
      repository = await this.findProjectRepository(projectId);
    }
    if (!repository || repository.status !== 'active') {
      throw new ServiceUnavailableException(
        'Automatic GitHub repository provisioning is waiting for Nexus operations',
      );
    }
    return this.syncCollaborators(
      projectId,
      {
        includeTaskAssignees: Boolean(project.implementationFundedAt),
        includePlanningAssignees: Boolean(project.planningFundedAt),
        permission: DEFAULT_PERMISSION,
      },
      null,
    );
  }

  async revokeIfNoLongerAssigned(
    projectId: string,
    freelancerProfileId: string,
  ) {
    const [taskCount, assignmentCount] = await Promise.all([
      this.taskRepo.count({
        where: {
          projectId,
          assignedFreelancerProfileId: freelancerProfileId,
          status: Not('cancelled'),
        },
      }),
      this.assignmentRepo.count({
        where: {
          projectId,
          freelancerProfileId,
          status: In(ASSIGNMENT_ACTIVE_STATUSES),
        },
      }),
    ]);
    if (taskCount + assignmentCount > 0) return { revoked: false };
    const row = await this.collaboratorRepo.findOne({
      where: { projectId, freelancerProfileId },
      relations: ['repository', 'freelancerProfile'],
    });
    if (!row || row.inviteStatus === 'removed') return { revoked: false };
    const username =
      row.freelancerProfile?.githubUsername ?? row.githubUsername;
    if (!username) {
      row.inviteStatus = 'removed';
      row.removedAt = new Date();
      await this.collaboratorRepo.save(row);
      return { revoked: true };
    }
    try {
      await this.github.removeCollaborator({
        owner: row.repository.owner,
        repoName: row.repository.repoName,
        username,
      });
      row.inviteStatus = 'removed';
      row.removedAt = new Date();
      row.metadata = {
        operation: 'revoke',
        completedAt: new Date().toISOString(),
      };
      await this.collaboratorRepo.save(row);
      if (row.freelancerProfile?.userId) {
        await this.notificationsService.createNotification({
          userId: row.freelancerProfile.userId,
          projectId,
          type: 'repository_access_removed',
          title: 'Repository access removed',
          body: 'Your repository access was removed because you are no longer assigned to this project.',
          actionUrl: '/freelancer/projects',
        });
      }
      return { revoked: true };
    } catch (error) {
      row.inviteStatus = 'failed';
      row.metadata = {
        operation: 'revoke',
        error: error instanceof Error ? error.message : String(error),
      };
      await this.collaboratorRepo.save(row);
      throw error;
    }
  }

  async reconcileAutomation() {
    const cutoff = new Date(Date.now() - 5 * 60_000);
    const projectIds = new Set<string>();
    const failedRepositories = await this.repoRepo.find({
      where: {
        status: In(['failed', 'creating']),
        updatedAt: LessThanOrEqual(cutoff),
      },
      take: 20,
      order: { updatedAt: 'ASC' },
    });
    for (const repository of failedRepositories) {
      projectIds.add(repository.projectId);
    }

    const missingTaskProjects = await this.taskRepo
      .createQueryBuilder('task')
      .select('DISTINCT task.projectId', 'projectId')
      .innerJoin(
        Project,
        'fundedTaskProject',
        'fundedTaskProject.id = task.projectId AND fundedTaskProject.implementationFundedAt IS NOT NULL',
      )
      .leftJoin(
        RepositoryCollaborator,
        'collaborator',
        'collaborator.projectId = task.projectId AND collaborator.freelancerProfileId = task.assignedFreelancerProfileId',
      )
      .where('task.assignedFreelancerProfileId IS NOT NULL')
      .andWhere('task.status != :cancelled', { cancelled: 'cancelled' })
      .andWhere(
        '(collaborator.id IS NULL OR collaborator.inviteStatus = :removed)',
        { removed: 'removed' },
      )
      .limit(100)
      .getRawMany<{ projectId: string }>();
    const missingPlanningProjects = await this.assignmentRepo
      .createQueryBuilder('assignment')
      .select('DISTINCT assignment.projectId', 'projectId')
      .innerJoin(
        Project,
        'fundedPlanningProject',
        'fundedPlanningProject.id = assignment.projectId AND fundedPlanningProject.planningFundedAt IS NOT NULL',
      )
      .leftJoin(
        RepositoryCollaborator,
        'collaborator',
        'collaborator.projectId = assignment.projectId AND collaborator.freelancerProfileId = assignment.freelancerProfileId',
      )
      .where('assignment.status IN (:...statuses)', {
        statuses: ASSIGNMENT_ACTIVE_STATUSES,
      })
      .andWhere('assignment.freelancerProfileId IS NOT NULL')
      .andWhere(
        '(collaborator.id IS NULL OR collaborator.inviteStatus = :removed)',
        { removed: 'removed' },
      )
      .limit(100)
      .getRawMany<{ projectId: string }>();
    for (const row of [...missingTaskProjects, ...missingPlanningProjects]) {
      projectIds.add(row.projectId);
    }

    let provisioned = 0;
    for (const projectId of projectIds) {
      try {
        await this.provisionForAssignedTeam(projectId);
        await this.incidents.resolveOperation(
          'repositories',
          'provision_project',
          projectId,
        );
        provisioned += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Automatic repository provisioning failed for ${projectId}: ${message}`,
        );
        await this.incidents.record({
          subsystem: 'repositories',
          operation: 'provision_project',
          projectId,
          errorCode: 'provisioning_failed',
          message,
        });
      }
    }

    const retryRows = await this.collaboratorRepo.find({
      where: {
        inviteStatus: In(['missing_username', 'failed', 'sending']),
        updatedAt: LessThanOrEqual(cutoff),
      },
      relations: ['freelancerProfile'],
      take: 50,
      order: { updatedAt: 'ASC' },
    });
    let retried = 0;
    for (const row of retryRows) {
      if (row.metadata?.operation === 'revoke') {
        if (!row.freelancerProfileId) continue;
        try {
          await this.revokeIfNoLongerAssigned(
            row.projectId,
            row.freelancerProfileId,
          );
          retried += 1;
        } catch {
          // The row keeps its retryable failed state.
        }
        continue;
      }
      if (!row.freelancerProfile?.githubUsername) continue;
      try {
        await this.resendInvite(row.id, {});
        retried += 1;
      } catch {
        // The row keeps its retryable failed state.
      }
    }
    return { provisioned, retried };
  }

  // Sends the GitHub invite and records the outcome on the row. Failures are
  // stored as `failed` so the admin can retry them from the UI.
  private async sendInvite(
    repository: ProjectRepository,
    row: RepositoryCollaborator,
  ) {
    const previousFailure =
      row.inviteStatus === 'failed' && typeof row.metadata?.error === 'string'
        ? row.metadata.error
        : null;
    let failure: string | null = null;
    let failureTrace: string | null = null;
    try {
      const result = await this.github.inviteCollaborator({
        owner: repository.owner,
        repoName: repository.repoName,
        username: row.githubUsername!,
        permission: row.permission,
      });
      row.githubUserId = result.githubUserId ?? row.githubUserId;
      row.inviteUrl = result.inviteUrl ?? row.inviteUrl;
      row.invitedAt = new Date();
      if (result.alreadyCollaborator) {
        row.inviteStatus = 'accepted';
        row.acceptedAt = row.acceptedAt ?? new Date();
      } else {
        row.inviteStatus = 'invited';
      }
      row.metadata = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `GitHub invite failed for ${row.githubUsername}: ${message}`,
      );
      row.inviteStatus = 'failed';
      row.metadata = { error: message };
      failure = message;
      failureTrace = error instanceof Error ? (error.stack ?? null) : null;
    }
    await this.collaboratorRepo.save(row);
    if (failure && failure !== previousFailure) {
      await this.notifyTechnicalIssue(
        row.projectId,
        'GitHub collaborator invitation failed',
        `${row.githubUsername ?? 'Unknown GitHub user'}: ${failure}`,
        {
          operation: 'invite_collaborator',
          errorCode: 'collaborator_invite_failed',
          trace: failureTrace,
          context: {
            collaboratorId: row.id,
            githubUsername: row.githubUsername,
          },
        },
      );
    }
    return row;
  }

  private async notifyTechnicalIssue(
    projectId: string,
    title: string,
    body: string,
    details: {
      operation: string;
      errorCode: string;
      trace?: string | null;
      context?: Record<string, unknown>;
    },
  ) {
    try {
      await this.incidents.record({
        subsystem: 'repositories',
        operation: details.operation,
        projectId,
        errorCode: details.errorCode,
        message: body,
        context: details.context,
        trace: details.trace,
      });
      const reviewer = await this.assignmentRepo.findOne({
        where: {
          projectId,
          phase: 'governance',
          roleKey: 'principal_reviewer',
          status: In(ASSIGNMENT_ACTIVE_STATUSES),
        },
        relations: ['freelancerProfile'],
      });
      if (!reviewer?.freelancerProfile?.userId) return;
      await this.notificationsService.createNotification({
        userId: reviewer.freelancerProfile.userId,
        projectId,
        type: 'reviewer_attention',
        title,
        body: 'Repository automation needs operations attention. You can continue tracking the project from your reviewer workspace.',
        actionUrl: `/reviewer/projects/${projectId}`,
      });
    } catch (error) {
      this.logger.error(
        `Could not notify operations about repository failure for ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async notifyInvite(
    profile: FreelancerProfile,
    repository: ProjectRepository,
  ) {
    if (!profile.userId) return;
    await this.notificationsService.createNotification({
      userId: profile.userId,
      projectId: repository.projectId,
      type: 'repository_access',
      title: 'Repository access',
      body: `You were invited to the project repository ${repository.owner}/${repository.repoName}.`,
      actionUrl: `/freelancer/projects/${repository.projectId}`,
    });
  }

  // Who should have repository access: task assignees by default, optionally the
  // planning role assignees, plus any explicitly requested profiles.
  private async resolveCollaboratorProfileIds(
    projectId: string,
    dto: SyncCollaboratorsDto,
  ) {
    const ids = new Set<string>(dto.freelancerProfileIds ?? []);

    if (dto.includeTaskAssignees !== false) {
      const rows = await this.taskRepo
        .createQueryBuilder('t')
        .select('DISTINCT t.assigned_freelancer_profile_id', 'profileId')
        .where('t.project_id = :projectId', { projectId })
        .andWhere('t.assigned_freelancer_profile_id IS NOT NULL')
        .andWhere('t.status != :cancelled', { cancelled: 'cancelled' })
        .getRawMany<{ profileId: string }>();
      for (const row of rows) ids.add(row.profileId);
    }

    if (dto.includePlanningAssignees) {
      const rows = await this.assignmentRepo.find({
        where: { projectId, status: In(ASSIGNMENT_ACTIVE_STATUSES) },
        select: { freelancerProfileId: true },
      });
      for (const row of rows) {
        if (row.freelancerProfileId) ids.add(row.freelancerProfileId);
      }
    }

    return Array.from(ids);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async findProjectRepository(projectId: string) {
    return this.repoRepo.findOne({
      where: { projectId, status: Not('archived') },
      order: { createdAt: 'DESC' },
    });
  }

  private async claimCollaboratorRow(
    repository: ProjectRepository,
    projectId: string,
    freelancerProfileId: string,
  ) {
    return this.repoRepo.manager.transaction(async (manager) => {
      await manager
        .getRepository(ProjectRepository)
        .createQueryBuilder('repository')
        .setLock('pessimistic_write')
        .where('repository.id = :repositoryId', {
          repositoryId: repository.id,
        })
        .getOneOrFail();
      const existing = await manager.findOne(RepositoryCollaborator, {
        where: { repositoryId: repository.id, freelancerProfileId },
      });
      if (existing) return existing;
      return manager.save(
        RepositoryCollaborator,
        manager.create(RepositoryCollaborator, {
          repositoryId: repository.id,
          projectId,
          freelancerProfileId,
          inviteStatus: 'pending',
        }),
      );
    });
  }

  private async waitForRepositoryProvisioning(repositoryId: string) {
    const deadline = Date.now() + 12_000;
    let repository = await this.repoRepo.findOneByOrFail({ id: repositoryId });
    while (repository.status === 'creating' && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      repository = await this.repoRepo.findOneByOrFail({ id: repositoryId });
    }
    return repository;
  }

  private async createOrRecoverRemoteRepository(input: {
    owner: string;
    repoName: string;
    visibility: string;
    description?: string | null;
  }) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // GET-first makes a retry safe when GitHub created the repository but
        // the original response was lost before the local row was committed.
        const existing = await this.github.findRepository(input);
        if (existing) return existing;
        return await this.github.createRepository(input);
      } catch (error) {
        lastError = error;
        if (!this.isRetryableGithubError(error) || attempt === 2) throw error;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, 250 * 2 ** attempt),
        );
      }
    }
    throw lastError;
  }

  /**
   * Repository names were derived from the project title alone, so two projects
   * called "mobile store" and "Mobile Store" both wanted `project-mobile-store`.
   * GitHub answered 422 and the unique index on (provider, owner, repo) threw
   * straight after. The project id suffix makes the name unique per project
   * while staying stable across retries for the same project. ISSUES.md #3.
   */
  private buildRepoName(project: Project, attempt = 0) {
    const slug = (project.title ?? 'project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    const base = `project-${slug ? `${slug}-` : ''}${project.id.slice(0, 8)}`;
    return attempt > 0 ? `${base}-${attempt + 1}` : base;
  }

  private isNameTakenError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /422|already exists|name already/i.test(message);
  }

  private isRetryableGithubError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /unreachable|timed?\s*out|status (?:408|425|429|5\d\d)\b/i.test(
      message,
    );
  }

  private async getCollaboratorCounts(repositoryIds: string[]) {
    const counts = new Map<
      string,
      { total: number; missingUsername: number }
    >();
    if (!repositoryIds.length) return counts;

    const rows = await this.collaboratorRepo
      .createQueryBuilder('c')
      .select('c.repository_id', 'repositoryId')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        `COUNT(*) FILTER (WHERE c.invite_status = 'missing_username')`,
        'missingUsername',
      )
      .where('c.repository_id IN (:...repositoryIds)', { repositoryIds })
      .groupBy('c.repository_id')
      .getRawMany<{
        repositoryId: string;
        total: string;
        missingUsername: string;
      }>();

    for (const row of rows) {
      counts.set(row.repositoryId, {
        total: Number(row.total),
        missingUsername: Number(row.missingUsername),
      });
    }
    return counts;
  }

  private toRepositoryResponse(row: ProjectRepository) {
    return {
      id: row.id,
      projectId: row.projectId,
      provider: row.provider,
      owner: row.owner,
      repoName: row.repoName,
      repoUrl: row.repoUrl,
      defaultBranch: row.defaultBranch,
      status: row.status,
      error: (row.metadata?.error as string | undefined) ?? null,
      evaluationWebhook:
        (row.metadata?.evaluationWebhook as
          Record<string, unknown> | undefined) ?? null,
      lastSyncedAt: row.lastSyncedAt,
      createdAt: row.createdAt,
    };
  }

  private toCollaboratorResponse(row: RepositoryCollaborator) {
    const profile = row.freelancerProfile;
    const user = profile?.user;
    return {
      id: row.id,
      repositoryId: row.repositoryId,
      projectId: row.projectId,
      freelancerProfileId: row.freelancerProfileId,
      freelancerName:
        [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null,
      githubUsername: row.githubUsername,
      permission: row.permission,
      inviteStatus: row.inviteStatus,
      inviteUrl: row.inviteUrl,
      invitedAt: row.invitedAt,
      acceptedAt: row.acceptedAt,
      error: (row.metadata?.error as string | undefined) ?? null,
    };
  }

  private async getProject(projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  // Admin sees everything, the customer sees their own project, and a freelancer
  // needs an active assignment (implementation task or planning role).
  private async assertProjectVisibility(
    project: Project,
    requester: Requester,
  ) {
    if (requester.role === UserRole.ADMIN) return;

    if (requester.role === UserRole.CUSTOMER) {
      if (project.customerId !== requester.userId) {
        throw new ForbiddenException('You can only access your own project');
      }
      return;
    }

    const profile = await this.profileRepo.findOne({
      where: { userId: requester.userId },
      select: { id: true },
    });
    if (!profile) {
      throw new ForbiddenException('You are not assigned to this project');
    }

    const assignedTasks = await this.taskRepo.count({
      where: { projectId: project.id, assignedFreelancerProfileId: profile.id },
    });
    if (assignedTasks > 0) return;

    const assignment = await this.assignmentRepo.count({
      where: {
        projectId: project.id,
        freelancerProfileId: profile.id,
        status: In(ASSIGNMENT_ACTIVE_STATUSES),
      },
    });
    if (!assignment) {
      throw new ForbiddenException('You are not assigned to this project');
    }
  }
}
