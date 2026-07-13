import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Project } from '../projects/entities/project.entity';
import { FreelancerProfile } from '../freelancers/entities/freelancer-profile.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';

export interface SearchResult {
  type: 'project' | 'freelancer' | 'user' | 'task';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
    @InjectRepository(FreelancerProfile)
    private freelancerProfileRepository: Repository<FreelancerProfile>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async search(query: string, userId: string, role: UserRole): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const results: SearchResult[] = [];
    const searchTerm = `%${query.trim()}%`;

    // 1. Search projects (for customers and admins)
    if (role === UserRole.CUSTOMER || role === UserRole.ADMIN) {
      const projectQuery = this.projectRepository
        .createQueryBuilder('project')
        .where('project.title ILIKE :search', { search: searchTerm })
        .orWhere('project.description ILIKE :search', { search: searchTerm });

      // If customer, only show their own projects
      if (role === UserRole.CUSTOMER) {
        projectQuery.andWhere('project.customerId = :userId', { userId });
      }

      const projects = await projectQuery
        .select(['project.id', 'project.title', 'project.description'])
        .getMany();

      projects.forEach((p) => {
        results.push({
          type: 'project',
          id: p.id,
          title: p.title,
          subtitle: p.description ? p.description.slice(0, 60) : 'Project',
          href: `/projects/${p.id}`,
        });
      });
    }

    // 2. Search freelancers (for customers and admins)
    if (role === UserRole.CUSTOMER || role === UserRole.ADMIN) {
      const freelancers = await this.freelancerProfileRepository
        .createQueryBuilder('fp')
        .leftJoinAndSelect('fp.user', 'user')
        .where('fp.headline ILIKE :search', { search: searchTerm })
        .orWhere('fp.bio ILIKE :search', { search: searchTerm })
        .orWhere('fp.skills::text ILIKE :search', { search: searchTerm })
        .orWhere('user.firstName ILIKE :search', { search: searchTerm })
        .orWhere('user.lastName ILIKE :search', { search: searchTerm })
        .select([
          'fp.id',
          'fp.headline',
          'fp.bio',
          'fp.skills',
          'user.id',
          'user.firstName',
          'user.lastName',
        ])
        .getMany();

      freelancers.forEach((fp) => {
        const fullName = `${fp.user.firstName} ${fp.user.lastName}`;
        results.push({
          type: 'freelancer',
          id: fp.id,
          title: fullName,
          subtitle: fp.headline || fp.bio?.slice(0, 60) || 'Freelancer',
          href: `/dashboard/admin/freelancers/${fp.id}`, // Admin detail; for customer maybe different
        });
      });
    }

    // 3. Search users (admin only)
    if (role === UserRole.ADMIN) {
      const users = await this.userRepository
        .createQueryBuilder('user')
        .where('user.firstName ILIKE :search', { search: searchTerm })
        .orWhere('user.lastName ILIKE :search', { search: searchTerm })
        .orWhere('user.email ILIKE :search', { search: searchTerm })
        .select(['user.id', 'user.firstName', 'user.lastName', 'user.email', 'user.role'])
        .getMany();

      users.forEach((u) => {
        results.push({
          type: 'user',
          id: u.id,
          title: `${u.firstName} ${u.lastName}`,
          subtitle: u.email,
          href: `/dashboard/admin/users/${u.id}`,
        });
      });
    }

    // Limit results to avoid overloading
    return results.slice(0, 20);
  }
}