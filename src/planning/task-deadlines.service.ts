import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, Repository } from 'typeorm';
import { FreelancerPerformanceEvent } from 'src/freelancers/entities/freelancer-performance-event.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { MatchingService } from 'src/matching/matching.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { EscrowLedgerEntry } from 'src/payments/entities/escrow-ledger-entry.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { ProjectTaskDependency } from 'src/projects/entities/project-task-dependency.entity';
import { TaskCheckpoint } from 'src/projects/entities/task-checkpoint.entity';
import { Project } from 'src/projects/entities/project.entity';

@Injectable()
export class TaskDeadlinesService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TaskDeadlinesService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(TaskCheckpoint)
    private readonly checkpointRepo: Repository<TaskCheckpoint>,
    @InjectRepository(ProjectTask)
    private readonly taskRepo: Repository<ProjectTask>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    private readonly dataSource: DataSource,
    private readonly matchingService: MatchingService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.reconcileOverdue(), 60_000);
    this.timer.unref();
    setTimeout(() => void this.reconcileOverdue(), 8_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async list(taskId: string, userId: string, isAdmin: boolean) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (!isAdmin) {
      const profile = await this.profileRepo.findOne({ where: { userId } });
      const reviewer = await this.matchingService.isPrincipalReviewer(
        userId,
        task.projectId,
      );
      if (task.assignedFreelancerProfileId !== profile?.id && !reviewer) {
        throw new ForbiddenException('You cannot access these checkpoints');
      }
    }
    return this.checkpointRepo.find({
      where: { taskId },
      order: { orderIndex: 'ASC' },
    });
  }

  async complete(checkpointId: string, userId: string) {
    const profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('Freelancer profile not found');
    const checkpoint = await this.checkpointRepo.findOne({
      where: { id: checkpointId },
      relations: ['task'],
    });
    if (!checkpoint) throw new NotFoundException('Checkpoint not found');
    if (checkpoint.task.assignedFreelancerProfileId !== profile.id) {
      throw new ForbiddenException('This checkpoint is not assigned to you');
    }
    if (!['pending', 'missed'].includes(checkpoint.status)) {
      throw new ConflictException('Checkpoint is already completed');
    }
    const now = new Date();
    const graceEnds = new Date(
      checkpoint.dueAt.getTime() + checkpoint.graceMinutes * 60_000,
    );
    if (checkpoint.status === 'pending' && now > graceEnds) {
      const removal = await this.applyMissedCheckpoint(checkpoint.id);
      if (removal) {
        await this.matchingService.removeTaskAssignee(
          removal.taskId,
          'Automatic removal after repeated missed task checkpoints',
          null,
        );
        throw new ConflictException(
          'The checkpoint grace period expired and this task is being rematched',
        );
      }
      const reconciled = await this.checkpointRepo.findOne({
        where: { id: checkpoint.id },
      });
      if (!reconciled || reconciled.status === 'deferred') {
        throw new ConflictException(
          'The checkpoint schedule changed; refresh the task before completing it',
        );
      }
      checkpoint.status = reconciled.status;
      checkpoint.dueAt = reconciled.dueAt;
      checkpoint.penaltyAmount = reconciled.penaltyAmount;
      checkpoint.assessedAt = reconciled.assessedAt;
    }
    checkpoint.completedAt = now;
    checkpoint.status = now <= checkpoint.dueAt ? 'met' : 'completed_late';
    checkpoint.assessedAt = checkpoint.assessedAt ?? now;
    await this.checkpointRepo.save(checkpoint);
    return checkpoint;
  }

  async reconcileOverdue() {
    if (this.running) return { inspected: 0, penalized: 0 };
    this.running = true;
    try {
      const due = await this.checkpointRepo.find({
        where: { status: 'pending', dueAt: LessThanOrEqual(new Date()) },
        relations: ['task'],
        order: { dueAt: 'ASC' },
        take: 100,
      });
      let penalized = 0;
      for (const checkpoint of due) {
        const graceEnds = new Date(
          checkpoint.dueAt.getTime() + checkpoint.graceMinutes * 60_000,
        );
        if (graceEnds > new Date()) continue;
        try {
          const removal = await this.applyMissedCheckpoint(checkpoint.id);
          penalized += 1;
          if (removal) {
            await this.matchingService.removeTaskAssignee(
              removal.taskId,
              'Automatic removal after repeated missed task checkpoints',
              null,
            );
          }
        } catch (error) {
          this.logger.error(
            `Checkpoint ${checkpoint.id} reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return { inspected: due.length, penalized };
    } finally {
      this.running = false;
    }
  }

  private async applyMissedCheckpoint(checkpointId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const checkpoint = await manager
        .getRepository(TaskCheckpoint)
        .createQueryBuilder('checkpoint')
        .setLock('pessimistic_write')
        .where('checkpoint.id = :checkpointId', { checkpointId })
        .getOne();
      if (!checkpoint || checkpoint.status !== 'pending') return null;
      const task = await manager.findOne(ProjectTask, {
        where: { id: checkpoint.taskId },
      });
      if (!task?.assignedFreelancerProfileId) {
        // Staffing delays are not freelancer failures. Park the checkpoint;
        // assignment acceptance rebases it onto the assignee's real schedule.
        checkpoint.status = 'deferred';
        checkpoint.assessedAt = new Date();
        await manager.save(TaskCheckpoint, checkpoint);
        return null;
      }
      const unfinishedDependencies = await manager
        .getRepository(ProjectTask)
        .createQueryBuilder('dependencyTask')
        .innerJoin(
          ProjectTaskDependency,
          'dependency',
          'dependency.depends_on_task_id = dependencyTask.id AND dependency.task_id = :taskId',
          { taskId: task.id },
        )
        .where('dependencyTask.status != :done', { done: 'done' })
        .andWhere("dependency.dependency_type IN ('blocks', 'after')")
        .getCount();
      if (unfinishedDependencies > 0) {
        const shiftMs = 60 * 60 * 1000;
        const pending = await manager.getRepository(TaskCheckpoint).find({
          where: { taskId: task.id, status: 'pending' },
        });
        for (const pendingCheckpoint of pending) {
          pendingCheckpoint.dueAt = new Date(
            pendingCheckpoint.dueAt.getTime() + shiftMs,
          );
        }
        task.startsAt = task.startsAt
          ? new Date(task.startsAt.getTime() + shiftMs)
          : task.startsAt;
        task.dueAt = task.dueAt
          ? new Date(task.dueAt.getTime() + shiftMs)
          : task.dueAt;
        if (pending.length) {
          await manager.getRepository(TaskCheckpoint).save(pending);
        }
        await manager.save(ProjectTask, task);
        return null;
      }
      const budget = Number(task.budgetAmount ?? 0);
      const currentPenalty = Number(task.penaltyAmount ?? 0);
      const requestedPenalty =
        Math.round(budget * Number(checkpoint.penaltyPercent) * 100) / 10_000;
      const penalty = Math.max(
        0,
        Math.min(requestedPenalty, budget * 0.25 - currentPenalty),
      );
      checkpoint.status = 'missed';
      checkpoint.assessedAt = new Date();
      checkpoint.penaltyAmount = penalty.toFixed(2);
      task.deadlineStrikes += 1;
      task.penaltyAmount = (currentPenalty + penalty).toFixed(2);
      await manager.save(TaskCheckpoint, checkpoint);
      await manager.save(ProjectTask, task);

      if (penalty > 0) {
        await manager.save(
          EscrowLedgerEntry,
          manager.create(EscrowLedgerEntry, {
            projectId: task.projectId,
            paymentId: null,
            milestoneId: task.milestoneId,
            approvedSubmissionId: null,
            releaseRequestId: null,
            freelancerProfileId: task.assignedFreelancerProfileId,
            entryType: 'penalty',
            amount: penalty.toFixed(2),
            currency: task.currency ?? 'EGP',
            status: 'posted',
            reason: `Missed checkpoint: ${checkpoint.title}`,
            stripeTransferId: null,
            stripeRefundId: null,
            createdBy: null,
            postedAt: new Date(),
            metadata: {
              checkpointId: checkpoint.id,
              taskId: task.id,
            },
          }),
        );
        await manager
          .getRepository(Project)
          .createQueryBuilder()
          .update(Project)
          .set({ releasedAmount: () => '"released_amount" + :penalty' })
          .where('id = :projectId', { projectId: task.projectId })
          .setParameter('penalty', penalty.toFixed(2))
          .execute();
      }

      const profile = await manager.findOne(FreelancerProfile, {
        where: { id: task.assignedFreelancerProfileId },
      });
      if (profile) {
        profile.missedDeadlines += 1;
        profile.performanceScore = Math.max(
          0,
          Number(profile.performanceScore) - 5,
        ).toFixed(2);
        await manager.save(FreelancerProfile, profile);
        await manager.save(
          FreelancerPerformanceEvent,
          manager.create(FreelancerPerformanceEvent, {
            freelancerProfileId: profile.id,
            projectId: task.projectId,
            taskId: task.id,
            eventType: 'checkpoint_missed',
            scoreDelta: '-5.00',
            moneyDelta: (-penalty).toFixed(2),
            currency: task.currency,
            reason: `Missed checkpoint: ${checkpoint.title}`,
            metadata: {
              checkpointId: checkpoint.id,
              deadlineStrikes: task.deadlineStrikes,
            },
          }),
        );
      }
      return {
        taskId: task.id,
        projectId: task.projectId,
        profileUserId: profile?.userId ?? null,
        penalty,
        currency: task.currency,
        title: checkpoint.title,
        remove: task.deadlineStrikes >= task.maxDeadlineStrikes,
      };
    });
    if (!result) return null;
    if (result.profileUserId) {
      await this.notificationsService.createNotification({
        userId: result.profileUserId,
        projectId: result.projectId,
        taskId: result.taskId,
        type: 'deadline_missed',
        title: 'Task checkpoint missed',
        body: `${result.title} was missed. ${result.penalty.toFixed(2)} ${result.currency ?? ''} was deducted from the task payout.${result.remove ? ' The assignment is being rematched.' : ''}`,
        actionUrl: '/tasks',
      });
    }
    const reviewer = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .findOne({
        where: {
          projectId: result.projectId,
          phase: 'governance',
          roleKey: 'principal_reviewer',
          status: In(['accepted', 'in_progress']),
        },
        relations: ['freelancerProfile'],
      });
    if (reviewer?.freelancerProfile?.userId) {
      await this.notificationsService.createNotification({
        userId: reviewer.freelancerProfile.userId,
        projectId: result.projectId,
        taskId: result.taskId,
        type: 'reviewer_attention',
        title: 'Deadline intervention required',
        body: `${result.title} was missed.${result.remove ? ' Automatic rematching started.' : ''}`,
        actionUrl: `/reviewer/projects/${result.projectId}`,
      });
    }
    return result.remove ? { taskId: result.taskId } : null;
  }
}
