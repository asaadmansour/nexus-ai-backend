import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AiService,
  type PlanningEvaluationResult,
} from 'src/agents/ai.service';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { UserRole } from 'src/common/enums/user-role.enum';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { Brief } from 'src/projects/entities/brief.entity';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectPlanningSubmission } from 'src/projects/entities/project-planning-submission.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { AiJobsProducer } from 'src/queues/ai-jobs.producer';
import { AI_JOB_RETRY } from 'src/queues/queue.constants';
import type { PlanningSubmissionEvaluationJobData } from 'src/queues/queue.types';
import {
  buildPlanningEvaluationRequirements,
  type PlanningEvaluationRequirement,
  type PlanningSubmissionType,
} from './planning-evaluation-requirements';

@Injectable()
export class PlanningEvaluationsService {
  private readonly logger = new Logger(PlanningEvaluationsService.name);

  constructor(
    @InjectRepository(ProjectPlanningSubmission)
    private readonly submissionRepo: Repository<ProjectPlanningSubmission>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Brief)
    private readonly briefRepo: Repository<Brief>,
    @InjectRepository(AgentJob)
    private readonly agentJobRepo: Repository<AgentJob>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    @InjectRepository(ProjectRoleAssignment)
    private readonly assignmentRepo: Repository<ProjectRoleAssignment>,
    private readonly aiService: AiService,
    private readonly aiJobsProducer: AiJobsProducer,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getRequirements(
    projectId: string,
    type: PlanningSubmissionType,
    requester: { userId: string; role: UserRole },
  ) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (requester.role === UserRole.FREELANCER) {
      const profile = await this.profileRepo.findOne({
        where: { userId: requester.userId },
        select: { id: true },
      });
      const assignment = profile
        ? await this.assignmentRepo.findOne({
            where: {
              projectId,
              freelancerProfileId: profile.id,
              roleKey: type === 'architecture' ? 'architect' : 'ui_ux',
              status: In(['assigned', 'accepted', 'in_progress', 'completed']),
            },
            select: { id: true },
          })
        : null;
      if (!assignment) {
        throw new ForbiddenException(
          'You can only view requirements for your planning assignment',
        );
      }
    }
    const [brief, architecture] = await Promise.all([
      this.briefRepo.findOne({ where: { projectId } }),
      this.latestApprovedArchitecture(projectId),
    ]);

    return {
      projectId,
      submissionType: type,
      architectureApproved: Boolean(architecture),
      architectureSubmissionId: architecture?.id ?? null,
      requirements: buildPlanningEvaluationRequirements(type, brief),
    };
  }

  async queueSubmissionEvaluation(
    submissionId: string,
    requestedBy?: string | null,
  ) {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.status !== 'submitted') {
      throw new BadRequestException(
        'Only submitted planning deliverables can be evaluated',
      );
    }

    const type = this.submissionType(submission.submissionType);
    const brief = await this.briefRepo.findOne({
      where: { projectId: submission.projectId },
    });
    const requirements = buildPlanningEvaluationRequirements(type, brief);
    submission.evaluationRequirements = {
      version: 1,
      submissionType: type,
      requirements,
    };

    if (
      type === 'ui_ux' &&
      !(await this.latestApprovedArchitecture(submission.projectId))
    ) {
      submission.evaluationStatus = 'pending_architecture';
      submission.evaluationError =
        'UI/UX evaluation waits for an approved architecture contract.';
      await this.submissionRepo.save(submission);
      return {
        status: 'pending_architecture',
        submissionId: submission.id,
        agentJobId: null,
      };
    }

    if (['queued', 'running'].includes(submission.evaluationStatus)) {
      return {
        status: submission.evaluationStatus,
        submissionId: submission.id,
        agentJobId: submission.evaluationAgentJobId,
        reused: true,
      };
    }

    submission.evaluationStatus = 'queued';
    submission.evaluationScore = null;
    submission.evaluationRecommendation = null;
    submission.evaluationResult = null;
    submission.evaluationError = null;
    submission.evaluatedAt = null;
    await this.submissionRepo.save(submission);

    try {
      const job =
        await this.aiJobsProducer.emitPlanningSubmissionEvaluationRequested({
          submissionId: submission.id,
          projectId: submission.projectId,
          requestedBy,
        });
      submission.evaluationAgentJobId = job.id;
      await this.submissionRepo.save(submission);
      return {
        status: 'queued',
        submissionId: submission.id,
        agentJobId: job.id,
      };
    } catch (error) {
      submission.evaluationStatus = 'failed';
      submission.evaluationError = this.errorMessage(error);
      await this.submissionRepo.save(submission);
      return {
        status: 'failed',
        submissionId: submission.id,
        agentJobId: null,
        error: submission.evaluationError,
      };
    }
  }

  async retry(submissionId: string, requestedBy: string) {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    if (['queued', 'running'].includes(submission.evaluationStatus)) {
      throw new ConflictException('Evaluation is already active');
    }
    return this.queueSubmissionEvaluation(submissionId, requestedBy);
  }

  async queueLatestPendingUiux(projectId: string, requestedBy: string) {
    const submission = await this.submissionRepo.findOne({
      where: {
        projectId,
        submissionType: 'ui_ux',
        status: 'submitted',
        evaluationStatus: In(['pending', 'pending_architecture', 'failed']),
      },
      order: { version: 'DESC' },
    });
    if (!submission) return null;
    return this.queueSubmissionEvaluation(submission.id, requestedBy);
  }

  async processPlanningSubmissionEvaluation(
    data: PlanningSubmissionEvaluationJobData,
    attemptsMade: number,
    maxAttempts: number = AI_JOB_RETRY.ATTEMPTS,
  ) {
    const submission = await this.submissionRepo.findOne({
      where: { id: data.submissionId },
      relations: ['freelancerProfile'],
    });
    if (!submission) {
      await this.markJobFailed(
        data.agentJobId,
        'Planning submission no longer exists',
        attemptsMade + 1,
      );
      return;
    }

    submission.evaluationStatus = 'running';
    submission.evaluationError = null;
    await this.submissionRepo.save(submission);
    await this.markJobRunning(data.agentJobId, attemptsMade + 1);

    try {
      const payload = await this.buildPayload(submission);
      const result = await this.aiService.evaluatePlanningSubmission(payload);
      await this.saveResult(submission, result);
      await this.markJobCompleted(data.agentJobId, result);
      try {
        await this.notifyOwner(submission, result);
      } catch (error) {
        this.logger.warn(
          `Planning evaluation ${submission.id} completed but notification failed: ${this.errorMessage(error)}`,
        );
      }
      return result;
    } catch (error) {
      const attempt = attemptsMade + 1;
      if (attempt >= maxAttempts) {
        submission.evaluationStatus = 'failed';
        submission.evaluationError = this.errorMessage(error);
        await this.submissionRepo.save(submission);
        await this.markJobFailed(data.agentJobId, error, attempt);
      } else {
        submission.evaluationStatus = 'queued';
        submission.evaluationError = this.errorMessage(error);
        await this.submissionRepo.save(submission);
        await this.agentJobRepo.update(data.agentJobId, {
          status: 'retrying',
          attempts: attempt,
          error: this.errorMessage(error),
          lockedAt: null,
        });
      }
      throw error;
    }
  }

  private async buildPayload(submission: ProjectPlanningSubmission) {
    const type = this.submissionType(submission.submissionType);
    const [project, brief, architecture] = await Promise.all([
      this.projectRepo.findOne({ where: { id: submission.projectId } }),
      this.briefRepo.findOne({ where: { projectId: submission.projectId } }),
      type === 'ui_ux'
        ? this.latestApprovedArchitecture(submission.projectId)
        : Promise.resolve(null),
    ]);
    if (!project) throw new NotFoundException('Project not found');
    if (type === 'ui_ux' && !architecture) {
      throw new BadRequestException(
        'UI/UX evaluation requires approved architecture',
      );
    }
    const snapshot = this.asRecord(submission.evaluationRequirements);
    const requirements = Array.isArray(snapshot.requirements)
      ? (snapshot.requirements as PlanningEvaluationRequirement[])
      : buildPlanningEvaluationRequirements(type, brief);

    return {
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        budgetMin: project.budgetMin,
        budgetMax: project.budgetMax,
        currency: project.currency,
        deadline: project.deadline,
      },
      brief: brief
        ? {
            summary: brief.summary,
            projectType: brief.projectType,
            domain: brief.domain,
            mainGoal: brief.mainGoal,
            targetUsers: brief.targetUsers,
            coreFeatures: brief.coreFeatures,
            platforms: brief.platforms,
            technical: brief.technical,
            nonFunctional: brief.nonFunctional,
            acceptanceCriteria: brief.acceptanceCriteria,
          }
        : {},
      requirements,
      submission: {
        submissionId: submission.id,
        submissionType: type,
        title: submission.title,
        summary: submission.summary,
        content: submission.content ?? {},
        fileUrls: submission.fileUrls ?? {},
      },
      approvedArchitecture: architecture
        ? {
            submissionId: architecture.id,
            summary: architecture.summary,
            content: architecture.content ?? {},
            fileUrls: architecture.fileUrls ?? {},
          }
        : null,
    };
  }

  private async saveResult(
    submission: ProjectPlanningSubmission,
    result: PlanningEvaluationResult,
  ) {
    submission.evaluationStatus = 'completed';
    submission.evaluationScore = result.score.toFixed(2);
    submission.evaluationRecommendation = result.recommendation;
    submission.evaluationResult = result;
    submission.evaluationError = null;
    submission.evaluatedAt = new Date();
    if (result.recommendation !== 'approve') {
      submission.status = 'changes_requested';
    }
    await this.submissionRepo.save(submission);
  }

  private async notifyOwner(
    submission: ProjectPlanningSubmission,
    result: PlanningEvaluationResult,
  ) {
    const userId = submission.freelancerProfile?.userId;
    if (!userId) return;
    await this.notificationsService.createNotification({
      userId,
      projectId: submission.projectId,
      title:
        result.recommendation === 'approve'
          ? 'Planning deliverable ready for admin review'
          : 'Planning deliverable needs revision',
      body:
        result.recommendation === 'approve'
          ? `AI evaluation passed with score ${result.score}. An admin will make the final decision.`
          : result.revisionItems.slice(0, 3).join(' ') || result.summary,
    });
  }

  private async latestApprovedArchitecture(projectId: string) {
    return this.submissionRepo.findOne({
      where: {
        projectId,
        submissionType: 'architecture',
        status: 'approved',
      },
      order: { version: 'DESC' },
    });
  }

  private submissionType(value: string): PlanningSubmissionType {
    if (value === 'architecture' || value === 'ui_ux') return value;
    throw new BadRequestException('Unsupported planning submission type');
  }

  private async markJobRunning(agentJobId: string, attempt: number) {
    await this.agentJobRepo.update(agentJobId, {
      status: 'running',
      attempts: attempt,
      startedAt: new Date(),
      lockedAt: new Date(),
      error: null,
    });
  }

  private async markJobCompleted(
    agentJobId: string,
    output: PlanningEvaluationResult,
  ) {
    await this.agentJobRepo.update(agentJobId, {
      status: 'completed',
      output,
      completedAt: new Date(),
      lockedAt: null,
      error: null,
    });
  }

  private async markJobFailed(
    agentJobId: string,
    error: unknown,
    attempt: number,
  ) {
    await this.agentJobRepo.update(agentJobId, {
      status: 'failed',
      attempts: attempt,
      error: this.errorMessage(error),
      failedAt: new Date(),
      lockedAt: null,
    });
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private errorMessage(error: unknown) {
    return error instanceof Error
      ? error.message.slice(0, 2000)
      : String(error);
  }
}
