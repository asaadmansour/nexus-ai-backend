import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { UserRole } from 'src/common/enums/user-role.enum';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { ProjectPlanningSubmission } from 'src/projects/entities/project-planning-submission.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { Project } from 'src/projects/entities/project.entity';
import { User } from 'src/users/entities/user.entity';
import { CreatePaymentReleaseRequestDto } from './dtos/create-payment-release-request.dto';
import { ListPaymentReleaseRequestsDto } from './dtos/list-payment-release-requests.dto';
import { ReviewPaymentReleaseRequestDto } from './dtos/review-payment-release-request.dto';
import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { PaymentReleaseRequest } from './entities/payment-release-request.entity';
import { ProjectPayment } from './entities/project-payment.entity';
import { PayoutAutomationService } from './payout-automation.service';

@Injectable()
export class PaymentReleaseRequestsService {
  private readonly logger = new Logger(PaymentReleaseRequestsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PaymentReleaseRequest)
    private readonly releaseRequestsRepository: Repository<PaymentReleaseRequest>,
    @InjectRepository(EscrowLedgerEntry)
    private readonly ledgerRepository: Repository<EscrowLedgerEntry>,
    @InjectRepository(Project)
    private readonly projectsRepository: Repository<Project>,
    @InjectRepository(ProjectSubmission)
    private readonly submissionsRepository: Repository<ProjectSubmission>,
    @InjectRepository(FreelancerProfile)
    private readonly freelancerProfilesRepository: Repository<FreelancerProfile>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly payoutAutomationService: PayoutAutomationService,
  ) {}

  async create(
    projectId: string,
    dto: CreatePaymentReleaseRequestDto,
    requester: JwtPayload,
    options: { notifyRequested?: boolean } = {},
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      const project = await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', { projectId })
        .getOne();
      if (!project) throw new NotFoundException('Project not found');
      this.assertProjectRequestAccess(project, requester);

      const submission = await manager
        .getRepository(ProjectSubmission)
        .findOne({
          where: { id: dto.submissionId, projectId },
        });
      if (!submission)
        throw new NotFoundException('Approved submission not found');
      if (submission.status !== 'approved') {
        throw new ConflictException(
          'Payment release requires an approved submission',
        );
      }
      if (!submission.freelancerProfileId) {
        throw new ConflictException(
          'Approved submission has no responsible freelancer',
        );
      }
      if (!submission.taskId) {
        throw new ConflictException(
          'Implementation payment release requires an approved task submission',
        );
      }
      const task = await manager.getRepository(ProjectTask).findOne({
        where: { id: submission.taskId, projectId },
      });
      if (
        !task?.budgetAmount ||
        task.assignedFreelancerProfileId !== submission.freelancerProfileId
      ) {
        throw new ConflictException(
          'The approved submission no longer matches a funded task assignment',
        );
      }
      const freelancerProfileId =
        dto.freelancerProfileId ?? submission.freelancerProfileId;
      if (freelancerProfileId !== submission.freelancerProfileId) {
        throw new BadRequestException(
          'Release freelancer must match the approved submission owner',
        );
      }
      await this.assertFreelancerRequestAccess(
        requester,
        freelancerProfileId,
        manager.getRepository(FreelancerProfile),
      );

      const milestoneId = dto.milestoneId ?? submission.milestoneId;
      if (
        dto.milestoneId &&
        submission.milestoneId &&
        dto.milestoneId !== submission.milestoneId
      ) {
        throw new BadRequestException(
          'Release milestone must match the approved submission',
        );
      }
      if (milestoneId) {
        const milestone = await manager
          .getRepository(ProjectMilestone)
          .findOne({
            where: { id: milestoneId, projectId },
          });
        if (!milestone)
          throw new NotFoundException('Project milestone not found');
      }

      const currency = dto.currency.toUpperCase();
      const projectCurrency = (
        project.quotedCurrency ?? project.currency
      ).toUpperCase();
      if (currency !== projectCurrency) {
        throw new BadRequestException(
          `Release currency must be ${projectCurrency}`,
        );
      }

      const existing = await manager
        .getRepository(PaymentReleaseRequest)
        .findOne({
          where: {
            submissionId: submission.id,
            freelancerProfileId,
            status: In(['pending', 'approved', 'released']),
          },
        });
      if (existing) return { request: existing, created: false };

      const amount = this.toCents(dto.amount);
      const entitledAmount = Math.max(
        this.toCents(task.budgetAmount) - this.toCents(task.penaltyAmount ?? 0),
        0,
      );
      if (amount !== entitledAmount) {
        throw new BadRequestException(
          `Release amount must equal the task's net approved compensation of ${this.fromCents(entitledAmount)} ${currency}`,
        );
      }
      const available = await this.availableHeldCents(manager, project);
      if (amount > available) {
        throw new ConflictException(
          'Release amount exceeds unreserved held escrow',
        );
      }

      const paymentQb = manager
        .getRepository(ProjectPayment)
        .createQueryBuilder('payment')
        .where('payment.projectId = :projectId', { projectId })
        .andWhere('payment.status = :status', { status: 'succeeded' });
      if (milestoneId) {
        paymentQb.andWhere(
          '(payment.milestoneId = :milestoneId OR payment.milestoneId IS NULL)',
          { milestoneId },
        );
      } else {
        paymentQb.andWhere('payment.milestoneId IS NULL');
      }
      const payment = await paymentQb
        .orderBy('payment.paidAt', 'DESC', 'NULLS LAST')
        .addOrderBy('payment.createdAt', 'DESC')
        .getOne();
      if (!payment) {
        throw new ConflictException('No funded escrow payment was found');
      }

      const request = await manager.getRepository(PaymentReleaseRequest).save({
        projectId,
        milestoneId,
        submissionId: submission.id,
        paymentId: payment.id,
        freelancerProfileId,
        amount: this.fromCents(amount),
        currency,
        status: 'pending',
        reason: dto.reason ?? null,
        reviewNotes: null,
        requestedBy: requester.sub,
        reviewedBy: null,
        approvedAt: null,
        rejectedAt: null,
        releasedAt: null,
        metadata: {
          transferMode: this.transferMode(),
          stripeTransferId: null,
        },
      });
      return { request, created: true };
    });

    if (result.created && options.notifyRequested !== false) {
      await this.notifyReleaseRequested(result.request);
    }
    return result.request;
  }

  async createForApprovedSubmission(
    submission: ProjectSubmission,
    requester: JwtPayload,
  ) {
    if (!submission.taskId) {
      throw new BadRequestException('Automatic release requires a task');
    }
    const task = await this.dataSource.getRepository(ProjectTask).findOne({
      where: { id: submission.taskId, projectId: submission.projectId },
    });
    if (!task) throw new NotFoundException('Submission task not found');
    if (
      !submission.freelancerProfileId ||
      task.assignedFreelancerProfileId !== submission.freelancerProfileId
    ) {
      throw new ConflictException(
        'Submission owner must match the current task assignee',
      );
    }
    const existingTaskRelease = await this.releaseRequestsRepository
      .createQueryBuilder('request')
      .innerJoin('request.submission', 'submission')
      .where('submission.taskId = :taskId', { taskId: task.id })
      .andWhere('request.status IN (:...statuses)', {
        statuses: ['pending', 'approved', 'released'],
      })
      .orderBy('request.createdAt', 'DESC')
      .getOne();
    if (existingTaskRelease) return existingTaskRelease;
    if (!task.budgetAmount || !task.currency) {
      throw new BadRequestException(
        'Task compensation must be allocated before approval can create a release request',
      );
    }
    const project = await this.getProjectOrThrow(submission.projectId);
    const amount = Math.max(
      Number(task.budgetAmount) - Number(task.penaltyAmount ?? 0),
      0,
    );
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Task compensation is invalid');
    }
    return this.create(
      submission.projectId,
      {
        milestoneId: task.milestoneId ?? undefined,
        submissionId: submission.id,
        freelancerProfileId: submission.freelancerProfileId ?? undefined,
        amount,
        currency: task.currency ?? project.quotedCurrency ?? project.currency,
        reason:
          Number(task.penaltyAmount ?? 0) > 0
            ? `Approved task: ${task.title} (after ${Number(task.penaltyAmount).toFixed(2)} ${task.currency} deadline deductions)`
            : `Approved task: ${task.title}`,
      },
      requester,
      { notifyRequested: false },
    );
  }

  async createForApprovedPlanningSubmission(
    submission: ProjectPlanningSubmission,
    requester: JwtPayload,
    transactionManager?: EntityManager,
  ) {
    const operation = async (manager: EntityManager) => {
      if (submission.status !== 'approved') {
        throw new ConflictException(
          'Planning payment release requires an approved submission',
        );
      }
      if (!submission.assignmentId || !submission.freelancerProfileId) {
        throw new ConflictException(
          'Approved planning submission has no responsible assignment',
        );
      }
      const project = await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', { projectId: submission.projectId })
        .getOne();
      if (!project) throw new NotFoundException('Project not found');
      const assignment = await manager.findOne(ProjectRoleAssignment, {
        where: {
          id: submission.assignmentId,
          projectId: submission.projectId,
        },
      });
      if (
        !assignment ||
        assignment.freelancerProfileId !== submission.freelancerProfileId
      ) {
        throw new ConflictException(
          'Planning submission owner must match the role assignment',
        );
      }
      const amount = Number(assignment.budgetAmount);
      if (!assignment.currency || !Number.isFinite(amount) || amount <= 0) {
        throw new ConflictException(
          'Planning compensation must be allocated before approval',
        );
      }
      const existing = await manager.findOne(PaymentReleaseRequest, {
        where: {
          planningSubmissionId: submission.id,
          freelancerProfileId: submission.freelancerProfileId,
          status: In(['pending', 'approved', 'released']),
        },
      });
      if (existing) return { request: existing, created: false };

      const amountCents = this.toCents(amount);
      const availableCents = await this.availableHeldCents(manager, project);
      if (amountCents > availableCents) {
        throw new ConflictException(
          'Allocated planning payment exceeds unreserved held escrow',
        );
      }
      const payment = await manager
        .getRepository(ProjectPayment)
        .createQueryBuilder('payment')
        .where('payment.projectId = :projectId', {
          projectId: submission.projectId,
        })
        .andWhere('payment.status = :status', { status: 'succeeded' })
        .orderBy('payment.paidAt', 'DESC', 'NULLS LAST')
        .addOrderBy('payment.createdAt', 'DESC')
        .getOne();
      if (!payment) {
        throw new ConflictException('No funded escrow payment was found');
      }

      const request = await manager.save(
        PaymentReleaseRequest,
        manager.create(PaymentReleaseRequest, {
          projectId: submission.projectId,
          milestoneId: null,
          submissionId: null,
          planningSubmissionId: submission.id,
          roleAssignmentId: assignment.id,
          paymentId: payment.id,
          freelancerProfileId: submission.freelancerProfileId,
          amount: assignment.budgetAmount!,
          currency: assignment.currency,
          status: 'pending',
          reason: `Approved ${submission.submissionType} planning deliverable`,
          requestedBy: requester.sub,
          metadata: {
            transferMode: this.transferMode(),
            workType: 'planning',
            roleKey: assignment.roleKey,
          },
        }),
      );
      return { request, created: true };
    };

    if (transactionManager) {
      return (await operation(transactionManager)).request;
    }
    const result = await this.dataSource.transaction(operation);
    if (result.created) await this.notifyReleaseRequested(result.request);
    return result.request;
  }

  async notifyPlanningReleaseRequested(requestId: string) {
    const request = await this.releaseRequestsRepository.findOne({
      where: { id: requestId },
    });
    if (request) await this.notifyReleaseRequested(request);
  }

  async listProject(
    projectId: string,
    query: ListPaymentReleaseRequestsDto,
    requester: JwtPayload,
  ) {
    const project = await this.getProjectOrThrow(projectId);
    let forcedFreelancerProfileId: string | undefined;
    if (requester.role === UserRole.CUSTOMER) {
      if (project.customerId !== requester.sub) {
        throw new ForbiddenException('You cannot access this project');
      }
    } else if (requester.role === UserRole.FREELANCER) {
      const profile = await this.getFreelancerProfileOrThrow(requester.sub);
      forcedFreelancerProfileId = profile.id;
    }
    return this.list({ ...query, projectId }, forcedFreelancerProfileId);
  }

  async listAdmin(query: ListPaymentReleaseRequestsDto) {
    return this.list(query);
  }

  async review(
    requestId: string,
    dto: ReviewPaymentReleaseRequestDto,
    requester: JwtPayload,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      const requestRepo = manager.getRepository(PaymentReleaseRequest);
      const releaseRequest = await requestRepo
        .createQueryBuilder('request')
        .setLock('pessimistic_write', undefined, ['request'])
        .leftJoinAndSelect('request.project', 'project')
        .leftJoinAndSelect('request.submission', 'submission')
        .leftJoinAndSelect('request.planningSubmission', 'planningSubmission')
        .where('request.id = :requestId', { requestId })
        .getOne();
      if (!releaseRequest) {
        throw new NotFoundException('Payment release request not found');
      }

      const existingLedger = await manager
        .getRepository(EscrowLedgerEntry)
        .findOne({
          where: {
            releaseRequestId: releaseRequest.id,
            entryType: 'release',
            status: 'posted',
          },
        });
      if (releaseRequest.status === 'released' && existingLedger) {
        return {
          releaseRequest,
          ledgerEntry: existingLedger,
          governanceRelease: null,
        };
      }
      if (!['pending', 'approved'].includes(releaseRequest.status)) {
        throw new ConflictException(
          'This payment release request has already been reviewed',
        );
      }

      const now = new Date();
      releaseRequest.reviewedBy = requester.sub;
      releaseRequest.reviewNotes = dto.reviewNotes ?? null;
      if (dto.decision === 'rejected') {
        releaseRequest.status = 'rejected';
        releaseRequest.rejectedAt = now;
        releaseRequest.approvedAt = null;
        await requestRepo.save(releaseRequest);
        return { releaseRequest, ledgerEntry: null, governanceRelease: null };
      }

      releaseRequest.status = 'approved';
      releaseRequest.approvedAt = releaseRequest.approvedAt ?? now;
      releaseRequest.rejectedAt = null;
      if (!dto.releaseNow) {
        await requestRepo.save(releaseRequest);
        return { releaseRequest, ledgerEntry: null, governanceRelease: null };
      }

      const approvedImplementation =
        releaseRequest.submission?.status === 'approved';
      const approvedPlanning =
        releaseRequest.planningSubmission?.status === 'approved';
      if (!approvedImplementation && !approvedPlanning) {
        throw new ConflictException(
          'The linked submission is no longer approved',
        );
      }
      const project = await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', {
          projectId: releaseRequest.projectId,
        })
        .getOne();
      if (!project) throw new NotFoundException('Project not found');

      const amountCents = this.toCents(releaseRequest.amount);
      const remainingCents =
        this.toCents(project.heldAmount) - this.toCents(project.releasedAmount);
      if (amountCents > remainingCents) {
        throw new ConflictException(
          'Release amount exceeds remaining held escrow',
        );
      }

      const ledgerEntry = await manager.getRepository(EscrowLedgerEntry).save({
        projectId: releaseRequest.projectId,
        paymentId: releaseRequest.paymentId,
        milestoneId: releaseRequest.milestoneId,
        approvedSubmissionId: releaseRequest.submissionId,
        releaseRequestId: releaseRequest.id,
        freelancerProfileId: releaseRequest.freelancerProfileId,
        entryType: 'release',
        amount: releaseRequest.amount,
        currency: releaseRequest.currency,
        status: 'posted',
        reason: releaseRequest.reason ?? 'Approved delivery release',
        stripeTransferId: null,
        stripeRefundId: null,
        createdBy: requester.sub,
        postedAt: now,
        metadata: {
          transferMode: this.transferMode(),
          stripeTransferId: null,
        },
      });

      const releasedCents = this.toCents(project.releasedAmount) + amountCents;
      project.releasedAmount = this.fromCents(releasedCents);
      releaseRequest.status = 'released';
      releaseRequest.releasedAt = now;
      releaseRequest.metadata = {
        ...(releaseRequest.metadata ?? {}),
        transferMode: this.transferMode(),
        stripeTransferId: null,
        ledgerEntryId: ledgerEntry.id,
      };
      await requestRepo.save(releaseRequest);

      if (releaseRequest.milestoneId) {
        await this.updateMilestonePaidStatus(
          manager,
          releaseRequest.milestoneId,
        );
      }
      await manager.getRepository(Project).save(project);
      return { releaseRequest, ledgerEntry, governanceRelease: null };
    });

    await this.notifyReleaseReviewed(result.releaseRequest);
    const payoutEntries = [result.ledgerEntry].filter(
      (entry): entry is EscrowLedgerEntry => Boolean(entry),
    );
    const payout = await this.payoutAutomationService
      .processEntries(payoutEntries)
      .catch((error: unknown) => {
        this.logger.error(
          `Immediate payout dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          inspected: payoutEntries.length,
          transferred: 0,
          mode: this.transferMode(),
        };
      });
    return {
      ...result,
      stripeTransferId: result.ledgerEntry?.stripeTransferId ?? null,
      transferMode: this.transferMode(),
      payout,
    };
  }

  async completeProjectDelivery(projectId: string, acceptedBy: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const project = await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', { projectId })
        .getOne();
      if (!project) throw new NotFoundException('Project not found');
      if (project.status === ProjectStatus.COMPLETED) {
        const existing = await manager
          .getRepository(EscrowLedgerEntry)
          .findOne({
            where: {
              projectId,
              entryType: 'governance_release',
              status: 'posted',
            },
          });
        return { project, governanceRelease: existing, alreadyCompleted: true };
      }
      const taskRepo = manager.getRepository(ProjectTask);
      const [totalTasks, unfinishedTasks] = await Promise.all([
        taskRepo.count({ where: { projectId } }),
        taskRepo.count({
          where: {
            projectId,
            status: In([
              'todo',
              'blocked',
              'in_progress',
              'review',
              'changes_requested',
            ]),
          },
        }),
      ]);
      if (
        !project.implementationReadyAt ||
        totalTasks === 0 ||
        unfinishedTasks > 0
      ) {
        throw new ConflictException(
          'Project completion requires every implementation task to be accepted',
        );
      }
      const now = new Date();
      const governanceRelease = await this.releasePrincipalReviewerAllocation(
        manager,
        project,
        acceptedBy,
        now,
      );
      if (governanceRelease) {
        project.releasedAmount = this.fromCents(
          this.toCents(project.releasedAmount) +
            this.toCents(governanceRelease.amount),
        );
      }
      if (
        this.toCents(project.releasedAmount) < this.toCents(project.heldAmount)
      ) {
        throw new ConflictException(
          'Project escrow still contains unreleased contributor allocations',
        );
      }
      project.status = ProjectStatus.COMPLETED;
      project.automationStatus = 'completed';
      await manager.save(Project, project);
      return { project, governanceRelease, alreadyCompleted: false };
    });

    const payout = result.governanceRelease
      ? await this.payoutAutomationService
          .processEntries([result.governanceRelease])
          .catch((error: unknown) => {
            this.logger.error(
              `Principal payout dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return {
              inspected: 1,
              transferred: 0,
              mode: this.transferMode(),
              retryable: true,
            };
          })
      : { inspected: 0, transferred: 0, mode: this.transferMode() };
    if (result.governanceRelease?.freelancerProfileId) {
      const profile = await this.freelancerProfilesRepository.findOne({
        where: { id: result.governanceRelease.freelancerProfileId },
      });
      if (profile) {
        await this.notifyUsers(
          [profile.userId],
          'Principal reviewer payment released',
          `${result.governanceRelease.amount} ${result.governanceRelease.currency} was added to your earnings after the client accepted the integrated delivery.`,
          projectId,
        );
      }
    }
    return { ...result, payout };
  }

  private async list(
    query: ListPaymentReleaseRequestsDto,
    forcedFreelancerProfileId?: string,
  ) {
    const qb = this.releaseRequestsRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.project', 'project')
      .leftJoinAndSelect('request.milestone', 'milestone')
      .leftJoinAndSelect('request.submission', 'submission')
      .leftJoinAndSelect('request.freelancerProfile', 'freelancerProfile')
      .where('1 = 1');
    if (query.status) qb.andWhere('request.status = :status', query);
    if (query.projectId) qb.andWhere('request.projectId = :projectId', query);
    if (query.milestoneId) {
      qb.andWhere('request.milestoneId = :milestoneId', query);
    }
    const freelancerProfileId =
      forcedFreelancerProfileId ?? query.freelancerProfileId;
    if (freelancerProfileId) {
      qb.andWhere('request.freelancerProfileId = :freelancerProfileId', {
        freelancerProfileId,
      });
    }
    const [data, total] = await qb
      .orderBy('request.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return { data, total, page: query.page, limit: query.limit };
  }

  private assertProjectRequestAccess(project: Project, requester: JwtPayload) {
    if (requester.role === UserRole.ADMIN) return;
    if (
      requester.role === UserRole.CUSTOMER &&
      project.customerId !== requester.sub
    ) {
      throw new ForbiddenException(
        'You cannot request release for this project',
      );
    }
  }

  private async assertFreelancerRequestAccess(
    requester: JwtPayload,
    freelancerProfileId: string,
    profilesRepository: Repository<FreelancerProfile>,
  ) {
    if (requester.role !== UserRole.FREELANCER) return;
    const profile = await profilesRepository.findOne({
      where: { userId: requester.sub },
    });
    if (!profile || profile.id !== freelancerProfileId) {
      throw new ForbiddenException(
        'Freelancers can request release only for their own approved work',
      );
    }
  }

  private async availableHeldCents(
    manager: DataSource['manager'],
    project: Project,
  ) {
    const reserved = await manager
      .getRepository(PaymentReleaseRequest)
      .createQueryBuilder('request')
      .select('COALESCE(SUM(request.amount), 0)', 'amount')
      .where('request.projectId = :projectId', { projectId: project.id })
      .andWhere('request.status IN (:...statuses)', {
        statuses: ['pending', 'approved'],
      })
      .getRawOne<{ amount: string }>();
    return Math.max(
      this.toCents(project.heldAmount) -
        this.toCents(project.releasedAmount) -
        this.toCents(reserved?.amount ?? 0),
      0,
    );
  }

  private async updateMilestonePaidStatus(
    manager: DataSource['manager'],
    milestoneId: string,
  ) {
    const milestone = await manager.getRepository(ProjectMilestone).findOne({
      where: { id: milestoneId },
    });
    if (!milestone?.budgetAmount) return;
    const released = await manager
      .getRepository(EscrowLedgerEntry)
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.amount), 0)', 'amount')
      .where('entry.milestoneId = :milestoneId', { milestoneId })
      .andWhere('entry.entryType IN (:...entryTypes)', {
        entryTypes: ['release', 'penalty'],
      })
      .andWhere('entry.status = :status', { status: 'posted' })
      .getRawOne<{ amount: string }>();
    if (
      this.toCents(released?.amount ?? 0) >=
      this.toCents(milestone.budgetAmount)
    ) {
      await manager
        .getRepository(ProjectMilestone)
        .update(milestoneId, { status: 'paid' });
    }
  }

  private async releasePrincipalReviewerAllocation(
    manager: EntityManager,
    project: Project,
    createdBy: string,
    now: Date,
  ) {
    const ledgerRepo = manager.getRepository(EscrowLedgerEntry);
    const existing = await ledgerRepo.findOne({
      where: {
        projectId: project.id,
        entryType: 'governance_release',
        status: 'posted',
      },
    });
    if (existing) return null;

    const assignment = await manager
      .getRepository(ProjectRoleAssignment)
      .findOne({
        where: project.principalReviewerAssignmentId
          ? { id: project.principalReviewerAssignmentId, projectId: project.id }
          : {
              projectId: project.id,
              phase: 'governance',
              roleKey: 'principal_reviewer',
              status: In(['accepted', 'in_progress', 'completed']),
            },
      });
    if (!assignment?.freelancerProfileId || !assignment.budgetAmount) {
      return null;
    }

    const amountCents = this.toCents(assignment.budgetAmount);
    const remainingCents =
      this.toCents(project.heldAmount) - this.toCents(project.releasedAmount);
    if (amountCents <= 0 || amountCents > remainingCents) {
      throw new ConflictException(
        'Principal reviewer allocation does not match remaining escrow',
      );
    }

    const entry = await ledgerRepo.save(
      ledgerRepo.create({
        projectId: project.id,
        paymentId: null,
        milestoneId: null,
        approvedSubmissionId: null,
        releaseRequestId: null,
        freelancerProfileId: assignment.freelancerProfileId,
        entryType: 'governance_release',
        amount: assignment.budgetAmount,
        currency:
          assignment.currency ?? project.quotedCurrency ?? project.currency,
        status: 'posted',
        reason: 'Principal reviewer project oversight completed',
        stripeTransferId: null,
        stripeRefundId: null,
        createdBy,
        postedAt: now,
        metadata: {
          transferMode: this.transferMode(),
          assignmentId: assignment.id,
        },
      }),
    );
    assignment.status = 'completed';
    assignment.completedAt = assignment.completedAt ?? now;
    await manager.getRepository(ProjectRoleAssignment).save(assignment);
    return entry;
  }

  private transferMode() {
    return process.env.STRIPE_ENABLE_TRANSFERS === 'true'
      ? 'stripe_connect'
      : 'ledger_only';
  }

  private async getProjectOrThrow(projectId: string) {
    const project = await this.projectsRepository.findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private async getFreelancerProfileOrThrow(userId: string) {
    const profile = await this.freelancerProfilesRepository.findOne({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Freelancer profile not found');
    return profile;
  }

  private toCents(value: number | string) {
    const numberValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numberValue)) {
      throw new BadRequestException('Invalid monetary amount');
    }
    return Math.round(numberValue * 100);
  }

  private fromCents(value: number) {
    return (value / 100).toFixed(2);
  }

  private async notifyReleaseRequested(request: PaymentReleaseRequest) {
    const project = await this.getProjectOrThrow(request.projectId);
    const reviewer = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .findOne({
        where: {
          projectId: request.projectId,
          phase: 'governance',
          roleKey: 'principal_reviewer',
          status: In(['accepted', 'in_progress']),
        },
        relations: ['freelancerProfile'],
      });
    let operationalReviewerIds = reviewer?.freelancerProfile?.userId
      ? [reviewer.freelancerProfile.userId]
      : [];
    if (!operationalReviewerIds.length) {
      const admins = await this.usersRepository.find({
        where: { role: UserRole.ADMIN },
        select: { id: true },
      });
      operationalReviewerIds = admins.map((admin) => admin.id);
    }
    await this.notifyUsers(
      [...new Set([project.customerId, ...operationalReviewerIds])],
      'Payment release requested',
      request.reason ??
        `Release request for ${request.amount} ${request.currency}`,
      request.projectId,
    );
  }

  private async notifyReleaseReviewed(request: PaymentReleaseRequest) {
    const userIds = new Set<string>();
    if (request.requestedBy) userIds.add(request.requestedBy);
    const project = await this.getProjectOrThrow(request.projectId);
    userIds.add(project.customerId);
    if (request.freelancerProfileId) {
      const profile = await this.freelancerProfilesRepository.findOne({
        where: { id: request.freelancerProfileId },
      });
      if (profile) userIds.add(profile.userId);
    }
    await this.notifyUsers(
      [...userIds],
      `Payment release ${request.status}`,
      request.reviewNotes ?? `${request.amount} ${request.currency}`,
      request.projectId,
    );
  }

  private async notifyUsers(
    userIds: string[],
    title: string,
    body: string,
    projectId: string,
  ) {
    try {
      await Promise.all(
        userIds.map((userId) =>
          this.notificationsService.createNotification({
            userId,
            title,
            body,
            projectId,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Could not create payment notification: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
