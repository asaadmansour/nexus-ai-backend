import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { UpdateFreelancerDto } from './dtos/update-freelancer.dto';
import { sanitizeUser } from 'src/common/utils/sanitize-user.util';

@Injectable()
export class FreelancersService {
  constructor(
    @InjectRepository(FreelancerProfile)
    private readonly freelancerRepository: Repository<FreelancerProfile>,
  ) {}

  async getMyProfile(userId: string) {
    const profile = await this.freelancerRepository.findOne({
      where: { userId },
      relations: ['user'],
    });
    if (!profile)
      throw new NotFoundException(
        'Freelancer profile not found or role mismatch',
      );

    const safeUser = sanitizeUser(profile.user ?? null);

    return {
      status: 'success',
      profile: {
        ...profile,
        user: safeUser,
      },
    };
  }

  async updateMyProfile(userId: string, dto: UpdateFreelancerDto) {
    const profile = await this.freelancerRepository.findOne({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Freelancer profile not found');

    if (dto.headline !== undefined) profile.headline = dto.headline;
    if (dto.bio !== undefined) profile.bio = dto.bio;
    if (dto.skills !== undefined) profile.skills = dto.skills;
    if (dto.yearsExperience !== undefined)
      profile.yearsExperience = dto.yearsExperience;
    if (dto.hourlyRate !== undefined)
      profile.hourlyRate = dto.hourlyRate.toString();
    if (dto.isAvailable !== undefined) profile.isAvailable = dto.isAvailable;

    await this.freelancerRepository.save(profile);
    return {
      status: 'success',
      message: 'Freelancer profile updated successfully',
      profile,
    };
  }
}
