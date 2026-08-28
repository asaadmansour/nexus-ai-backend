import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dtos/create-project.dto';
import { UpdateProjectDto } from './dtos/update-project.dto';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { ProjectPayment } from 'src/payments/entities/project-payment.entity';
import { MIN_DEADLINE_LEAD_DAYS } from 'src/common/decorators/is-future-date.decorator';
import { ProjectRoleAssignment } from './entities/project-role-assignment.entity';
import { ProjectTask } from './entities/project-task.entity';
import { ProjectInvitation } from 'src/matching/entities/project-invitation.entity';
import { Notification } from 'src/notifications/entities/notification.entity';

const NON_DELETABLE_PROJECT_STATUSES = new Set<ProjectStatus>([
  ProjectStatus.PLANNING_ASSIGNED,
  ProjectStatus.PLANNING_IN_PROGRESS,
  ProjectStatus.PLANNING_REVIEW,
  ProjectStatus.IMPLEMENTATION_READY,
  ProjectStatus.READY_FOR_IMPLEMENTATION_FUNDING,
  ProjectStatus.MATCHED,
  ProjectStatus.SPEC_IN_PROGRESS,
  ProjectStatus.SPEC_UNDER_REVIEW,
  ProjectStatus.SPEC_COMPLETE,
  ProjectStatus.SCOPED,
  ProjectStatus.ASSIGNED,
  ProjectStatus.ACTIVE,
  ProjectStatus.UNDER_REVIEW,
  ProjectStatus.COMPLETED,
  ProjectStatus.DISPUTED,
]);

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(ProjectPayment)
    private readonly projectPaymentRepository: Repository<ProjectPayment>,
    private readonly dataSource: DataSource,
  ) {}

  async create(customerId: string, dto: CreateProjectDto) {
    this.assertDeadline(dto.deadline);
    const project = this.projectRepository.create({
      customerId,
      title: dto.title,
      description: dto.description,
      budgetMin: dto.budgetMin.toString(),
      budgetMax: dto.budgetMax.toString(),
      currency: dto.currency || 'EGP',
      deadline: dto.deadline ? new Date(dto.deadline) : null,
      isDeadlineFlexible: dto.isDeadlineFlexible ?? true,
    });
    return await this.projectRepository.save(project);
  }

  async findAllForCustomer(customerId: string) {
    return await this.projectRepository.find({
      where: { customerId },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll() {
    return await this.projectRepository.find({
      order: { createdAt: 'DESC' },
      relations: ['customer'],
    });
  }

  async findOne(id: string, userId: string, isAdmin: boolean) {
    const project = await this.projectRepository.findOne({
      where: { id },
      relations: ['customer'],
    });
    if (!project) throw new NotFoundException('Project not found');

    if (!isAdmin && project.customerId !== userId) {
      throw new ForbiddenException('You can only access your own projects');
    }

    return project;
  }

  async update(
    id: string,
    userId: string,
    isAdmin: boolean,
    dto: UpdateProjectDto,
  ) {
    const project = await this.findOne(id, userId, isAdmin);
    this.assertDeadline(dto.deadline);
    const quoteSensitiveChanged =
      dto.budgetMin !== undefined ||
      dto.budgetMax !== undefined ||
      dto.currency !== undefined ||
      dto.deadline !== undefined ||
      dto.isDeadlineFlexible !== undefined;
    if (
      quoteSensitiveChanged &&
      (project.quoteStatus === 'accepted' ||
        Number(project.heldAmount ?? 0) > 0)
    ) {
      throw new ConflictException(
        'Project budget, currency, and delivery deadline cannot change after the quote is accepted or escrow is funded',
      );
    }
    if (quoteSensitiveChanged) {
      const activePayment = await this.projectPaymentRepository.exists({
        where: {
          projectId: id,
          status: In(['requires_payment', 'processing', 'succeeded']),
        },
      });
      if (activePayment) {
        throw new ConflictException(
          'Project budget, currency, and delivery deadline cannot change while an escrow checkout is active or funded',
        );
      }
    }

    if (dto.title !== undefined) project.title = dto.title;
    if (dto.description !== undefined) project.description = dto.description;
    if (dto.budgetMin !== undefined)
      project.budgetMin = dto.budgetMin.toString();
    if (dto.budgetMax !== undefined)
      project.budgetMax = dto.budgetMax.toString();

    const resultingMin = parseFloat(project.budgetMin);
    const resultingMax = parseFloat(project.budgetMax);
    if (resultingMin > resultingMax) {
      throw new BadRequestException('budgetMin cannot exceed budgetMax');
    }

    if (dto.currency !== undefined) project.currency = dto.currency;
    if (quoteSensitiveChanged) {
      project.quotedAmount = null;
      project.quotedCurrency = null;
      project.quoteStatus = 'not_ready';
      project.quoteGeneratedAt = null;
      project.quoteNotes =
        'The customer changed quote-sensitive budget or schedule details. Reconfirm the requirements brief to generate a new price and compensation allocation.';
      project.budgetAllocation = null;
      project.quoteEvidence = null;
    }
    if (dto.deadline !== undefined)
      project.deadline = dto.deadline ? new Date(dto.deadline) : null;
    if (dto.isDeadlineFlexible !== undefined)
      project.isDeadlineFlexible = dto.isDeadlineFlexible;
    if (dto.status !== undefined) {
      if (!isAdmin) {
        throw new ForbiddenException('Only admins can change project status');
      }
      project.status = dto.status;
    }

    return await this.projectRepository.save(project);
  }

  async remove(id: string, userId: string, isAdmin: boolean) {
    await this.dataSource.transaction(async (manager) => {
      const project = await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :id', { id })
        .getOne();
      if (!project) throw new NotFoundException('Project not found');
      if (!isAdmin && project.customerId !== userId) {
        throw new ForbiddenException('You can only delete your own projects');
      }

      const acceptedAssignment = await manager.exists(ProjectRoleAssignment, {
        where: {
          projectId: id,
          status: In(['accepted', 'in_progress', 'completed']),
        },
      });
      if (
        project.principalReviewerAssignmentId ||
        acceptedAssignment ||
        NON_DELETABLE_PROJECT_STATUSES.has(project.status)
      ) {
        throw new ConflictException(
          'This project cannot be deleted after the principal reviewer or another freelancer has accepted it',
        );
      }

      const now = new Date();
      await manager.update(
        ProjectInvitation,
        { projectId: id, status: In(['pending', 'accepting']) },
        {
          status: 'cancelled',
          respondedAt: now,
          responseReason: 'Project deleted by the customer',
        },
      );
      await manager.update(
        ProjectRoleAssignment,
        { projectId: id, status: 'assigned' },
        {
          status: 'cancelled',
          endedAt: now,
          decisionReason: 'Project deleted by the customer',
        },
      );
      await manager.update(
        ProjectTask,
        { projectId: id },
        {
          status: 'cancelled',
          assignmentStatus: 'unassigned',
          assignedFreelancerProfileId: null,
        },
      );
      await manager.delete(Notification, { projectId: id });
      await manager.getRepository(Project).softDelete(id);
    });
  }

  private assertDeadline(value: string | undefined) {
    if (value === undefined) return;
    const deadline = new Date(value);
    const now = new Date();
    const minimum = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + MIN_DEADLINE_LEAD_DAYS,
        )
      : Date.now() + MIN_DEADLINE_LEAD_DAYS * 86_400_000;
    if (Number.isNaN(deadline.getTime()) || deadline.getTime() < minimum) {
      throw new BadRequestException(
        `Project deadline must be at least ${MIN_DEADLINE_LEAD_DAYS} day(s) from now`,
      );
    }
  }
}
