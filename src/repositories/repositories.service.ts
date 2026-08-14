import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
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
  ) {}

  // ---------------------------------------------------------------------------
  // Repository
  // ---------------------------------------------------------------------------

  // Idempotent by project: an existing non-archived repository is returned as
  // is, and a previously failed row is retried in place instead of duplicated.
  async createRepository(
    projectId: string,
    dto: CreateRepositoryDto,
    adminUserId: string,
  ) {
    const project = await this.getProject(projectId);
    const existing = await this.findProjectRepository(projectId);
    if (existing && existing.status !== 'failed') {
      return this.toRepositoryResponse(existing);
    }

    const owner = dto.owner ?? this.github.owner;
    if (!owner) {
      throw new ServiceUnavailableException(
        'GitHub is not configured (GITHUB_OWNER is missing)',
      );
    }
    const repoName = dto.repoName ?? this.buildRepoName(project);
    const visibility = dto.visibility ?? this.github.defaultVisibility;

    const row =
      existing ??
      this.repoRepo.create({
        projectId,
        provider: dto.provider ?? 'github',
        createdBy: adminUserId,
      });
    row.owner = owner;
    row.repoName = repoName;
    row.repoUrl = `https://github.com/${owner}/${repoName}`;
    row.defaultBranch = dto.defaultBranch ?? 'main';

    try {
      const created = await this.github.createRepository({
        owner,
        repoName,
        visibility,
        description: dto.description ?? project.title,
      });
      row.externalId = created.externalId;
      row.repoUrl = created.repoUrl;
      row.defaultBranch = created.defaultBranch;
      row.status = 'active';
      row.lastSyncedAt = new Date();
      row.metadata = { visibility };
    } catch (error) {
      // Never silently mock: keep the failure visible and retryable.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `GitHub repository creation failed for project ${projectId}: ${message}`,
      );
      row.status = 'failed';
      row.metadata = { visibility, error: message };
    }

    return this.toRepositoryResponse(await this.repoRepo.save(row));
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
    adminUserId: string,
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
      const row =
        (await this.collaboratorRepo.findOne({
          where: {
            repositoryId: repository.id,
            freelancerProfileId: profile.id,
          },
        })) ??
        this.collaboratorRepo.create({
          repositoryId: repository.id,
          projectId,
          freelancerProfileId: profile.id,
        });
      row.permission = permission;

      // Already invited or accepted: return the current row, do not re-invite.
      if (row.id && SETTLED_INVITE_STATUSES.includes(row.inviteStatus)) {
        continue;
      }

      if (!profile.githubUsername) {
        row.githubUsername = null;
        row.inviteStatus = 'missing_username';
        await this.collaboratorRepo.save(row);
        missingUsername += 1;
        continue;
      }

      row.githubUsername = profile.githubUsername;
      await this.sendInvite(repository, row);
      if (row.inviteStatus === 'invited' || row.inviteStatus === 'accepted') {
        invited += 1;
        await this.notifyInvite(profile, repository);
      }
    }

    repository.lastSyncedAt = new Date();
    await this.repoRepo.save(repository);
    this.logger.log(
      `Repository ${repository.id} synced by ${adminUserId}: ${invited} invited, ${missingUsername} missing username`,
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

  // Sends the GitHub invite and records the outcome on the row. Failures are
  // stored as `failed` so the admin can retry them from the UI.
  private async sendInvite(
    repository: ProjectRepository,
    row: RepositoryCollaborator,
  ) {
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
    }
    await this.collaboratorRepo.save(row);
    return row;
  }

  private async notifyInvite(
    profile: FreelancerProfile,
    repository: ProjectRepository,
  ) {
    if (!profile.userId) return;
    await this.notificationsService.createNotification({
      userId: profile.userId,
      projectId: repository.projectId,
      title: 'Repository access',
      body: `You were invited to the project repository ${repository.owner}/${repository.repoName}.`,
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

  private buildRepoName(project: Project) {
    const slug = (project.title ?? 'project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return `project-${slug || project.id.slice(0, 8)}`;
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
