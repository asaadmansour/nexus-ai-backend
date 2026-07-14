import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dtos/create-project.dto';
import { UpdateProjectDto } from './dtos/update-project.dto';
import { ProjectStatus } from 'src/common/enums/project-status.enum';

const NON_DELETABLE_PROJECT_STATUSES = new Set<ProjectStatus>([
  ProjectStatus.PLANNING_ASSIGNED,
  ProjectStatus.PLANNING_IN_PROGRESS,
  ProjectStatus.PLANNING_REVIEW,
  ProjectStatus.IMPLEMENTATION_READY,
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
  ) {}

  async create(customerId: string, dto: CreateProjectDto) {
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
    const project = await this.findOne(id, userId, isAdmin);

    if (NON_DELETABLE_PROJECT_STATUSES.has(project.status)) {
      throw new BadRequestException(
        'Projects cannot be deleted after they are assigned to freelancers',
      );
    }

    await this.projectRepository.softRemove(project);
  }
}
