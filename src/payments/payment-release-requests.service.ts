import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { UserRole } from 'src/common/enums/user-role.enum';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { Project } from 'src/projects/entities/project.entity';
import { User } from 'src/users/entities/user.entity';
import { CreatePaymentReleaseRequestDto } from './dtos/create-payment-release-request.dto';
import { ListPaymentReleaseRequestsDto } from './dtos/list-payment-release-requests.dto';
import { ReviewPaymentReleaseRequestDto } from './dtos/review-payment-release-request.dto';
import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { PaymentReleaseRequest } from './entities/payment-release-request.entity';
import { ProjectPayment } from './entities/project-payment.entity';

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
  ) {}

  async create(
    projectId: string,
    dto: CreatePaymentReleaseRequestDto,
    requester: JwtPayload,
  ) {
    const request = await this.dataSource.transaction(async (manager) => {
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
            status: In(['pending', 'approved']),
          },
        });
      if (existing) return existing;

      const amount = this.toCents(dto.amount);
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

      return manager.getRepository(PaymentReleaseRequest).save({
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
          transferMode: 'ledger_only',
          stripeTransferId: null,
        },
      });
    });

    await this.notifyReleaseRequested(request);
    return request;
  }

  async createForApprovedSubmission(
    submission: ProjectSubmission,
    requester: JwtPayload,
  ) {
    if (!submission.milestoneId) {
      throw new BadRequestException(
        'Automatic release requests require a milestone submission',
      );
    }
    const milestone = await this.dataSource
      .getRepository(ProjectMilestone)
      .findOne({ where: { id: submission.milestoneId } });
    if (!milestone?.budgetAmount) {
      throw new BadRequestException(
        'Milestone budget is required for automatic release requests',
      );
    }
    const project = await this.getProjectOrThrow(submission.projectId);
    const milestoneTasks = await this.dataSource
      .getRepository(ProjectTask)
      .find({ where: { milestoneId: submission.milestoneId } });
    const assignees = new Set(
      milestoneTasks
        .map((task) => task.assignedFreelancerProfileId)
        .filter((id): id is string => Boolean(id)),
    );
    if (
      assignees.size !== 1 ||
      !submission.freelancerProfileId ||
      !assignees.has(submission.freelancerProfileId)
    ) {
      throw new BadRequestException(
        'Use an explicit release request amount for milestones shared by multiple freelancers',
      );
    }
    const amount = Number(milestone.budgetAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Milestone budget is invalid');
    }
    return this.create(
      submission.projectId,
      {
        milestoneId: submission.milestoneId,
        submissionId: submission.id,
        freelancerProfileId: submission.freelancerProfileId ?? undefined,
        amount,
        currency:
          milestone.currency ?? project.quotedCurrency ?? project.currency,
        reason: `Approved submission: ${submission.title ?? submission.id}`,
      },
      requester,
    );
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
        return { releaseRequest, ledgerEntry: existingLedger };
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
        return { releaseRequest, ledgerEntry: null };
      }

      releaseRequest.status = 'approved';
      releaseRequest.approvedAt = releaseRequest.approvedAt ?? now;
      releaseRequest.rejectedAt = null;
      if (!dto.releaseNow) {
        await requestRepo.save(releaseRequest);
        return { releaseRequest, ledgerEntry: null };
      }

      if (releaseRequest.submission?.status !== 'approved') {
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
          transferMode: 'ledger_only',
          stripeTransferId: null,
        },
      });

      const releasedCents = this.toCents(project.releasedAmount) + amountCents;
      project.releasedAmount = this.fromCents(releasedCents);
      releaseRequest.status = 'released';
      releaseRequest.releasedAt = now;
      releaseRequest.metadata = {
        ...(releaseRequest.metadata ?? {}),
        transferMode: 'ledger_only',
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
      const unfinishedTasks = await manager.getRepository(ProjectTask).count({
        where: {
          projectId: project.id,
          status: In([
            'todo',
            'blocked',
            'in_progress',
            'review',
            'changes_requested',
          ]),
        },
      });
      if (
        unfinishedTasks === 0 &&
        releasedCents >= this.toCents(project.heldAmount)
      ) {
        project.status = ProjectStatus.COMPLETED;
      }
      await manager.getRepository(Project).save(project);
      return { releaseRequest, ledgerEntry };
    });

    await this.notifyReleaseReviewed(result.releaseRequest);
    return {
      ...result,
      stripeTransferId: null,
      transferMode: 'ledger_only',
    };
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
      .andWhere('entry.entryType = :entryType', { entryType: 'release' })
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
    const admins = await this.usersRepository.find({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });
    const project = await this.getProjectOrThrow(request.projectId);
    await this.notifyUsers(
      [...new Set([project.customerId, ...admins.map((admin) => admin.id)])],
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
