import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { FreelancerAssessment } from './entities/freelancer-assessment.entity';

// Maps the profile's verification_status to the single next action the
// freelancer should take. Other backend flows own advancing verification_status.
const NEXT_ACTION: Record<string, string> = {
  profile_incomplete: 'complete_profile',
  email_verification_pending: 'verify_email',
  id_verification_pending: 'wait_for_review',
  cv_pending: 'upload_cv',
  cv_processing: 'wait_for_cv_extraction',
  assessment_pending: 'start_assessment',
  assessment_in_progress: 'continue_assessment',
  assessment_submitted: 'wait_for_review',
  interview_pending: 'wait_for_review',
  approved: 'approved',
  rejected: 'rejected',
};

@Injectable()
export class FreelancerVerificationService {
  constructor(
    @InjectRepository(FreelancerProfile)
    private readonly profileRepository: Repository<FreelancerProfile>,
    @InjectRepository(FreelancerAssessment)
    private readonly assessmentRepository: Repository<FreelancerAssessment>,
  ) {}

  async getMyVerification(userId: string) {
    const profile = await this.profileRepository.findOne({
      where: { userId },
      relations: ['user'],
    });
    if (!profile) {
      throw new NotFoundException('Freelancer profile not found');
    }

    const assessment = await this.assessmentRepository.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const status = profile.verificationStatus;
    const emailVerified = profile.user?.isEmailVerified ?? false;
    const profileComplete = status !== 'profile_incomplete';
    const cvUploaded = Boolean(profile.cvUrl);
    const cvExtracted = Boolean(profile.skills && profile.skills.length > 0);

    const missing: string[] = [];
    if (!profileComplete) missing.push('profile');
    if (!emailVerified) missing.push('email');
    if (!cvUploaded) missing.push('cv');
    if (!cvExtracted) missing.push('cv_extraction');

    return {
      status: 'success',
      data: {
        userId: profile.userId,
        profileId: profile.id,
        verificationStatus: status,
        profileComplete,
        emailVerified,
        cvUploaded,
        cvExtracted,
        nextAction: NEXT_ACTION[status] ?? 'complete_profile',
        assessment: assessment
          ? {
              id: assessment.id,
              status: assessment.status,
              score: assessment.score,
              durationSeconds: assessment.durationSeconds,
              startedAt: assessment.startedAt,
              expiresAt: assessment.expiresAt,
              submittedAt: assessment.submittedAt,
            }
          : null,
        missing,
      },
    };
  }
}
