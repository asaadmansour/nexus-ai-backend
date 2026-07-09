import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dtos/create-project.dto';
import { UpdateProjectDto } from './dtos/update-project.dto';

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
      relations: ['customer']
    });
  }

  async findOne(id: string, userId: string, isAdmin: boolean) {
    const project = await this.projectRepository.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    
    if (!isAdmin && project.customerId !== userId) {
      throw new ForbiddenException('You can only access your own projects');
    }
    
    return project;
  }

  async update(id: string, userId: string, isAdmin: boolean, dto: UpdateProjectDto) {
    const project = await this.findOne(id, userId, isAdmin);
    
    if (dto.title !== undefined) project.title = dto.title;
    if (dto.description !== undefined) project.description = dto.description;
    if (dto.budgetMin !== undefined) project.budgetMin = dto.budgetMin.toString();
    if (dto.budgetMax !== undefined) project.budgetMax = dto.budgetMax.toString();
    if (dto.currency !== undefined) project.currency = dto.currency;
    if (dto.deadline !== undefined) project.deadline = dto.deadline ? new Date(dto.deadline) : null;
    if (dto.isDeadlineFlexible !== undefined) project.isDeadlineFlexible = dto.isDeadlineFlexible;
    if (dto.status !== undefined) project.status = dto.status;

    return await this.projectRepository.save(project);
  }
}
