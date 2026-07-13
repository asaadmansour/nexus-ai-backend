import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { FreelancerVerificationEvent } from './entities/freelancer-verification-event.entity';
import { UpdateFreelancerDto } from './dtos/update-freelancer.dto';
import { sanitizeUser } from 'src/common/utils/sanitize-user.util';

@Injectable()
export class FreelancersService {
  constructor(
    @InjectRepository(FreelancerProfile)
    private readonly freelancerRepository: Repository<FreelancerProfile>,
    @InjectRepository(FreelancerVerificationEvent)
    private readonly verificationEventRepository: Repository<FreelancerVerificationEvent>,
  ) {}

  async getMyProfile(userId: string) {
    const profile = await this.freelancerRepository.findOne({
      where: { userId },
      relations: ['user', 'skillScores'],
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
        skillScores: (profile.skillScores ?? []).sort(
          (a, b) => Number(b.score) - Number(a.score),
        ),
        user: safeUser,
      },
    };
  }

  async getPublicProfile(id: string) {
    const profile = await this.freelancerRepository.findOne({
      where: { id, verificationStatus: 'approved' },
      relations: ['user', 'skillScores'],
    });
    if (!profile) throw new NotFoundException('Freelancer profile not found');

    return {
      status: 'success',
      profile: {
        id: profile.id,
        userId: profile.userId,
        name: `${profile.user.firstName} ${profile.user.lastName}`,
        photoUrl: profile.user.photoUrl,
        headline: profile.headline,
        bio: profile.bio,
        skills: profile.skills,
        yearsExperience: profile.yearsExperience,
        hourlyRate: profile.hourlyRate,
        isAvailable: profile.isAvailable,
        availabilityHoursPerWeek: profile.availabilityHoursPerWeek,
        avgRating: profile.avgRating,
        ratingsCount: profile.ratingsCount,
        skillScores: (profile.skillScores ?? [])
          .sort((a, b) => Number(b.score) - Number(a.score))
          .map((skillScore) => ({
            id: skillScore.id,
            skill: skillScore.skill,
            score: skillScore.score,
            confidence: skillScore.confidence,
          })),
      },
    };
  }

  async updateMyProfile(userId: string, dto: UpdateFreelancerDto) {
    const profile = await this.freelancerRepository.findOne({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Freelancer profile not found');

    const previousStatus = profile.verificationStatus ?? null;

    if (dto.headline !== undefined) profile.headline = dto.headline;
    if (dto.bio !== undefined) profile.bio = dto.bio;
    if (dto.skills !== undefined) profile.skills = dto.skills;
    if (dto.yearsExperience !== undefined)
      profile.yearsExperience = dto.yearsExperience;
    if (dto.hourlyRate !== undefined)
      profile.hourlyRate = dto.hourlyRate.toString();
    if (dto.isAvailable !== undefined) profile.isAvailable = dto.isAvailable;
    if (dto.availabilityHoursPerWeek !== undefined) {
      profile.availabilityHoursPerWeek = dto.availabilityHoursPerWeek;
      profile.isAvailable = dto.availabilityHoursPerWeek > 0;
    }

    await this.freelancerRepository.save(profile);
    await this.verificationEventRepository.save(
      this.verificationEventRepository.create({
        freelancerProfileId: profile.id,
        userId,
        eventType: 'profile_updated',
        fromStatus: previousStatus,
        toStatus: profile.verificationStatus ?? null,
        actorType: 'freelancer',
        actorUserId: userId,
        metadata: {
          updatedFields: Object.keys(dto),
        },
      }),
    );

    return {
      status: 'success',
      message: 'Freelancer profile updated successfully',
      profile,
    };
  }
}
