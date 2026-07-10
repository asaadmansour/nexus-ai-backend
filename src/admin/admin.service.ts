import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { Project } from 'src/projects/entities/project.entity';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectRepository(Project) private projectRepository: Repository<Project>,
  ) {}

  async getUsers(pageNum: number, limitNum: number) {
    const [users, total] = await this.userRepository.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        isEmailVerified: true,
        isIdVerified: true,
        photoUrl: true,
        role: true,
        createdAt: true,
      },
    });
    return { users, total };
  }

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

  async getStats() {
    const totalUsers = await this.userRepository.count();
    const totalProjects = await this.projectRepository.count();
    return { totalUsers, totalProjects };
  }
}
