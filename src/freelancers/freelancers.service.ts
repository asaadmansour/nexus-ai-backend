import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { FreelancerVerificationEvent } from './entities/freelancer-verification-event.entity';
import { UpdateFreelancerDto } from './dtos/update-freelancer.dto';
import { sanitizeUser } from 'src/common/utils/sanitize-user.util';
import { FreelancerSkillScore } from './entities/freelancer-skill-score.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { User } from 'src/users/entities/user.entity';
import { UserRole } from 'src/common/enums/user-role.enum';
import { NotificationsService } from 'src/notifications/notifications.service';
import { ApplyPrincipalReviewerDto } from './dtos/apply-principal-reviewer.dto';
import {
  evaluatePrincipalReviewerQualification,
  PRINCIPAL_REVIEWER_ROLE,
} from './principal-reviewer-qualification';

const ACTIVE_REVIEWER_ASSIGNMENT_STATUSES = [
  'assigned',
  'accepted',
  'in_progress',
];

@Injectable()
export class FreelancersService {
  constructor(
    @InjectRepository(FreelancerProfile)
    private readonly freelancerRepository: Repository<FreelancerProfile>,
    @InjectRepository(FreelancerVerificationEvent)
    private readonly verificationEventRepository: Repository<FreelancerVerificationEvent>,
    @InjectRepository(FreelancerSkillScore)
    private readonly skillScoreRepository: Repository<FreelancerSkillScore>,
    @InjectRepository(ProjectRoleAssignment)
    private readonly roleAssignmentRepository: Repository<ProjectRoleAssignment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
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

    const principalReviewerActiveProjects =
      await this.countActivePrincipalReviewerProjects(profile.id);
    const principalReviewerEligibility = evaluatePrincipalReviewerQualification(
      profile,
      profile.skillScores ?? [],
    );

    return {
      status: 'success',
      profile: {
        ...profile,
        skillScores: (profile.skillScores ?? []).sort(
          (a, b) => Number(b.score) - Number(a.score),
        ),
        user: safeUser,
        principalReviewerActiveProjects,
        principalReviewerEligibility,
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

    if (dto.githubUsername !== undefined) {
      const duplicate = await this.freelancerRepository
        .createQueryBuilder('profile')
        .where('LOWER(profile.github_username) = LOWER(:githubUsername)', {
          githubUsername: dto.githubUsername,
        })
        .andWhere('profile.id <> :profileId', { profileId: profile.id })
        .getExists();
      if (duplicate) {
        throw new ConflictException(
          'This GitHub username is already registered.',
        );
      }
      profile.githubUsername = dto.githubUsername;
    }
    if (dto.headline !== undefined) profile.headline = dto.headline;
    if (dto.bio !== undefined) profile.bio = dto.bio;
    if (dto.skills !== undefined) profile.skills = dto.skills;
    if (dto.yearsExperience !== undefined)
      profile.yearsExperience = dto.yearsExperience;
    if (dto.hourlyRate !== undefined) {
      throw new BadRequestException(
        'Hourly rates are assessed by Nexus AI after verification and cannot be self-edited',
      );
    }
    if (dto.isAvailable !== undefined) profile.isAvailable = dto.isAvailable;
    if (dto.availabilityHoursPerWeek !== undefined) {
      profile.availabilityHoursPerWeek = dto.availabilityHoursPerWeek;
      profile.isAvailable = dto.availabilityHoursPerWeek > 0;
    }

    await this.freelancerRepository.save(profile);
    if (profile.principalReviewerStatus === 'approved') {
      const skillScores = await this.skillScoreRepository.find({
        where: { freelancerProfileId: profile.id },
      });
      const qualification = evaluatePrincipalReviewerQualification(
        profile,
        skillScores,
      );
      if (!qualification.eligibleToApply) {
        profile.principalReviewerStatus = 'suspended';
        profile.principalReviewerRejectionReason = qualification.gaps.join(' ');
        profile.principalReviewerReviewedAt = new Date();
        profile.principalReviewerQualification = {
          ...qualification,
          suspendedAt: new Date().toISOString(),
          source: 'profile_change',
        };
        await this.freelancerRepository.save(profile);
        await this.notificationsService.createNotification({
          userId,
          type: 'principal_reviewer_status',
          title: 'Principal reviewer eligibility paused',
          body: `Your profile no longer meets the principal reviewer requirements. ${qualification.gaps.join(' ')}`,
          actionUrl: '/profile',
        });
      }
    }
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

    const current = await this.getMyProfile(userId);
    return {
      status: 'success',
      message: 'Freelancer profile updated successfully',
      profile: current.profile,
    };
  }

  async applyForPrincipalReviewer(
    userId: string,
    dto: ApplyPrincipalReviewerDto,
  ) {
    const profile = await this.freelancerRepository.findOne({
      where: { userId },
      relations: ['skillScores'],
    });
    if (!profile) throw new NotFoundException('Freelancer profile not found');
    if (profile.principalReviewerStatus === 'pending') {
      throw new ConflictException(
        'Your principal reviewer application is already pending review',
      );
    }
    if (profile.principalReviewerStatus === 'approved') {
      throw new ConflictException('You are already a principal reviewer');
    }

    const qualification = evaluatePrincipalReviewerQualification(
      profile,
      profile.skillScores ?? [],
    );
    if (!qualification.eligibleToApply) {
      throw new BadRequestException({
        message: 'Principal reviewer requirements are not met yet',
        gaps: qualification.gaps,
      });
    }

    const previousStatus = profile.principalReviewerStatus;
    const appliedAt = new Date();
    const qualificationSnapshot = {
      ...qualification,
      statement: dto.statement?.trim() || null,
      snapshotAt: new Date().toISOString(),
    };
    const applied = await this.freelancerRepository
      .createQueryBuilder()
      .update(FreelancerProfile)
      .set({
        principalReviewerStatus: 'pending',
        principalReviewerAppliedAt: appliedAt,
        principalReviewerReviewedAt: null,
        principalReviewerReviewedBy: null,
        principalReviewerRejectionReason: null,
        principalReviewerQualification: () => ':qualificationSnapshot',
      })
      .where('id = :profileId', { profileId: profile.id })
      .andWhere('principal_reviewer_status = :previousStatus', {
        previousStatus,
      })
      .setParameter(
        'qualificationSnapshot',
        JSON.stringify(qualificationSnapshot),
      )
      .execute();
    if (!applied.affected) {
      throw new ConflictException(
        'Your principal reviewer application changed while it was being submitted. Refresh and try again.',
      );
    }
    profile.principalReviewerStatus = 'pending';
    profile.principalReviewerAppliedAt = appliedAt;
    profile.principalReviewerReviewedAt = null;
    profile.principalReviewerReviewedBy = null;
    profile.principalReviewerRejectionReason = null;
    profile.principalReviewerQualification = qualificationSnapshot;
    await this.recordPrincipalReviewerEvent(profile, userId, {
      eventType: 'principal_reviewer_applied',
      fromStatus: previousStatus,
      toStatus: 'pending',
      actorType: 'freelancer',
      actorUserId: userId,
      metadata: profile.principalReviewerQualification,
    });
    await this.notifyAdminsOfPrincipalReviewerApplication(profile);
    await this.notificationsService.createNotification({
      userId,
      type: 'principal_reviewer_status',
      title: 'Principal reviewer application received',
      body: 'Your senior reviewer qualification is awaiting human review. We will notify you when a decision is recorded.',
      actionUrl: '/profile',
    });
    return this.getMyProfile(userId);
  }

  async withdrawPrincipalReviewerApplication(userId: string) {
    const profile = await this.freelancerRepository.findOne({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Freelancer profile not found');
    if (profile.principalReviewerStatus === 'not_applied') {
      return this.getMyProfile(userId);
    }
    const previousStatus = profile.principalReviewerStatus;
    const withdrawn = await this.freelancerRepository
      .createQueryBuilder()
      .update(FreelancerProfile)
      .set({
        principalReviewerStatus: 'not_applied',
        principalReviewerAppliedAt: null,
        principalReviewerReviewedAt: null,
        principalReviewerReviewedBy: null,
        principalReviewerRejectionReason: null,
        principalReviewerHourlyRate: null,
        principalReviewerQualification: null,
      })
      .where('id = :profileId', { profileId: profile.id })
      .andWhere('principal_reviewer_status = :previousStatus', {
        previousStatus,
      })
      .andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM project_role_assignments active_reviewer_assignment
          WHERE active_reviewer_assignment.freelancer_profile_id = :profileId
            AND active_reviewer_assignment.phase = 'governance'
            AND active_reviewer_assignment.role_key = :reviewerRole
            AND active_reviewer_assignment.status IN ('assigned', 'accepted', 'in_progress')
        )`,
        { reviewerRole: PRINCIPAL_REVIEWER_ROLE },
      )
      .execute();
    if (!withdrawn.affected) {
      const activeProjects = await this.countActivePrincipalReviewerProjects(
        profile.id,
      );
      if (activeProjects > 0) {
        throw new ConflictException(
          'Finish or transfer active principal reviewer projects before withdrawing',
        );
      }
      throw new ConflictException(
        'Your principal reviewer status changed while withdrawing. Refresh and try again.',
      );
    }
    profile.principalReviewerStatus = 'not_applied';
    profile.principalReviewerAppliedAt = null;
    profile.principalReviewerReviewedAt = null;
    profile.principalReviewerReviewedBy = null;
    profile.principalReviewerRejectionReason = null;
    profile.principalReviewerHourlyRate = null;
    profile.principalReviewerQualification = null;
    await this.recordPrincipalReviewerEvent(profile, userId, {
      eventType: 'principal_reviewer_withdrawn',
      fromStatus: previousStatus,
      toStatus: 'not_applied',
      actorType: 'freelancer',
      actorUserId: userId,
      metadata: { activeProjects: 0 },
    });
    return this.getMyProfile(userId);
  }

  private countActivePrincipalReviewerProjects(profileId: string) {
    return this.roleAssignmentRepository.count({
      where: {
        freelancerProfileId: profileId,
        phase: 'governance',
        roleKey: PRINCIPAL_REVIEWER_ROLE,
        status: In(ACTIVE_REVIEWER_ASSIGNMENT_STATUSES),
      },
    });
  }

  private async recordPrincipalReviewerEvent(
    profile: FreelancerProfile,
    userId: string,
    input: Pick<
      FreelancerVerificationEvent,
      | 'eventType'
      | 'fromStatus'
      | 'toStatus'
      | 'actorType'
      | 'actorUserId'
      | 'metadata'
    >,
  ) {
    await this.verificationEventRepository.save(
      this.verificationEventRepository.create({
        freelancerProfileId: profile.id,
        userId,
        ...input,
      }),
    );
  }

  private async notifyAdminsOfPrincipalReviewerApplication(
    profile: FreelancerProfile,
  ) {
    const admins = await this.userRepository.find({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });
    await Promise.allSettled(
      admins.map((admin) =>
        this.notificationsService.createNotification({
          userId: admin.id,
          type: 'principal_reviewer_application',
          title: 'Principal reviewer application ready',
          body: 'A verified senior freelancer applied for principal reviewer qualification.',
          actionUrl: `/dashboard/admin/freelancers/${profile.id}`,
        }),
      ),
    );
  }
}
