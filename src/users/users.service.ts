import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { In, Repository } from 'typeorm';
import { UpdateUserDto } from './dtos/update-user.dto';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { FreelancerAssessment } from 'src/freelancers/entities/freelancer-assessment.entity';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sanitizeUser } from 'src/common/utils/sanitize-user.util';
import { FreelancerVerificationEvent } from 'src/freelancers/entities/freelancer-verification-event.entity';
import { AiJobsProducer } from 'src/queues/ai-jobs.producer';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(FreelancerProfile)
    private readonly freelancerProfileRepository: Repository<FreelancerProfile>,
    @InjectRepository(FreelancerAssessment)
    private readonly freelancerAssessmentRepository: Repository<FreelancerAssessment>,
    @InjectRepository(FreelancerVerificationEvent)
    private readonly verificationEventRepository: Repository<FreelancerVerificationEvent>,
    private readonly configService: ConfigService,
    private readonly aiJobsProducer: AiJobsProducer,
  ) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException(
        'Missing required Cloudinary configuration',
      );
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
  }

  async findMe(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['freelancerProfile'],
    });
    if (!user) throw new NotFoundException('No User found');

    const safeUser = sanitizeUser(user);
    return {
      status: 'success',
      user: {
        ...safeUser,
        cvUrl: user.freelancerProfile?.cvUrl ?? null,
      },
    };
  }

  async updateMe(updated: UpdateUserDto, userId: string) {
    const userUpdated = await this.userRepository.update(
      { id: userId },
      updated,
    );
    if (userUpdated.affected === 0)
      throw new NotFoundException('No User Found');
    return {
      status: 'updated successfully',
    };
  }

  async uploadAndSaveCv(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ status: string; cvUrl: string }> {
    const existingUser = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['freelancerProfile'],
    });
    if (!existingUser) throw new NotFoundException('User not found');

    const oldCvPublicId = (() => {
      const oldUrl = existingUser?.freelancerProfile?.cvUrl;
      if (!oldUrl) return null;
      const match = oldUrl.match(/cvs\/[^/]+$/);
      return match ? match[0] : null;
    })();

    const cvResult = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          folder: 'cvs',
          format: 'pdf',
          allowed_formats: ['pdf'],
          use_filename: false,
          unique_filename: true,
        },
        (error, result) => {
          if (error || !result) {
            return reject(
              new InternalServerErrorException(
                'Failed to upload CV to cloud storage',
              ),
            );
          }
          resolve(result);
        },
      );
      uploadStream.end(file.buffer);
    });

    try {
      const profile =
        existingUser.freelancerProfile ??
        this.freelancerProfileRepository.create({ userId });
      const previousStatus = profile.verificationStatus ?? null;

      profile.cvUrl = cvResult.secure_url;
      profile.cvExtractionStatus = 'queued';
      profile.cvExtractionError = null;
      profile.cvExtractedAt = null;
      profile.assessmentGenerationStatus = 'pending';
      profile.assessmentGenerationQueuedAt = null;
      profile.assessmentGenerationStartedAt = null;
      profile.assessmentGeneratedAt = null;
      profile.assessmentGenerationError = null;
      profile.assessmentGenerationJobId = null;
      profile.verificationStatus = 'cv_processing';

      const savedProfile = await this.freelancerProfileRepository.save(profile);
      await this.cancelOpenAssessmentsForNewCv(userId);
      await this.recordVerificationEvent({
        profile: savedProfile,
        eventType: 'cv_uploaded',
        fromStatus: previousStatus,
        toStatus: savedProfile.verificationStatus,
        actorType: 'freelancer',
        actorUserId: userId,
        metadata: {
          cvUrl: cvResult.secure_url,
        },
      });

      try {
        const extractionJob = await this.aiJobsProducer.emitCvUploaded({
          userId,
          profileId: savedProfile.id,
          cvUrl: cvResult.secure_url,
        });

        await this.recordVerificationEvent({
          profile: savedProfile,
          eventType: 'cv_extraction_queued',
          fromStatus: savedProfile.verificationStatus,
          toStatus: savedProfile.verificationStatus,
          actorType: 'system',
          metadata: {
            agentJobId: extractionJob.id,
            queueName: extractionJob.queueName,
          },
        });
      } catch (queueError) {
        savedProfile.cvExtractionStatus = 'failed';
        savedProfile.cvExtractionError = this.getErrorMessage(queueError);
        savedProfile.verificationStatus = 'cv_pending';
        const failedProfile =
          await this.freelancerProfileRepository.save(savedProfile);
        await this.recordVerificationEvent({
          profile: failedProfile,
          eventType: 'cv_extraction_queue_failed',
          fromStatus: 'cv_processing',
          toStatus: failedProfile.verificationStatus,
          actorType: 'system',
          metadata: {
            error: failedProfile.cvExtractionError,
          },
        });
        throw queueError;
      }

      if (oldCvPublicId) {
        cloudinary.uploader
          .destroy(oldCvPublicId, { resource_type: 'raw' })
          .catch((err) =>
            this.logger.error(
              `Failed to clean old CV asset ${oldCvPublicId}`,
              err,
            ),
          );
      }

      return { status: 'success', cvUrl: cvResult.secure_url };
    } catch (dbError) {
      cloudinary.uploader
        .destroy(cvResult.public_id, { resource_type: 'raw' })
        .catch((err) =>
          this.logger.error(
            `Failed to destroy rolled back CV asset ${cvResult.public_id}`,
            err,
          ),
        );
      throw dbError;
    }
  }

  async uploadAndSavePhoto(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ status: string; photoUrl: string }> {
    const existingUser = await this.userRepository.findOne({
      where: { id: userId },
    });
    const oldPhotoPublicId = (() => {
      const oldUrl = existingUser?.photoUrl;
      if (!oldUrl) return null;
      const match = oldUrl.match(/avatars\/[^/]+$/);
      if (!match) return null;
      let publicId = match[0];
      const extIdx = publicId.lastIndexOf('.');
      if (extIdx !== -1) publicId = publicId.substring(0, extIdx);
      return publicId;
    })();

    const photoResult = await new Promise<UploadApiResponse>(
      (resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'image',
            folder: 'avatars',
            format: 'webp',
            transformation: [
              { width: 400, height: 400, crop: 'fill', gravity: 'face' },
            ],
          },
          (error, result) => {
            if (error || !result) {
              return reject(
                new InternalServerErrorException(
                  'Failed to upload photo to cloud storage',
                ),
              );
            }
            resolve(result);
          },
        );
        uploadStream.end(file.buffer);
      },
    );

    try {
      const result = await this.userRepository.update(
        { id: userId },
        { photoUrl: photoResult.secure_url },
      );

      if (result.affected === 0) {
        cloudinary.uploader
          .destroy(photoResult.public_id)
          .catch((err) =>
            this.logger.error(
              `Failed to destroy orphaned photo asset ${photoResult.public_id}`,
              err,
            ),
          );
        throw new NotFoundException('User not found');
      }

      if (oldPhotoPublicId) {
        cloudinary.uploader
          .destroy(oldPhotoPublicId)
          .catch((err) =>
            this.logger.error(
              `Failed to clean old photo asset ${oldPhotoPublicId}`,
              err,
            ),
          );
      }

      return { status: 'success', photoUrl: photoResult.secure_url };
    } catch (dbError) {
      cloudinary.uploader
        .destroy(photoResult.public_id)
        .catch((err) =>
          this.logger.error(
            `Failed to destroy rolled back photo asset ${photoResult.public_id}`,
            err,
          ),
        );
      throw dbError;
    }
  }

  private async cancelOpenAssessmentsForNewCv(userId: string) {
    await this.freelancerAssessmentRepository.update(
      {
        userId,
        status: In(['pending', 'generating', 'ready', 'in_progress']),
      },
      {
        status: 'cancelled',
        aiFeedback: {
          systemReason: 'cancelled_after_new_cv_upload',
        },
      },
    );
  }

  private async recordVerificationEvent(input: {
    profile: FreelancerProfile;
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    actorType: string;
    actorUserId?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    await this.verificationEventRepository.save(
      this.verificationEventRepository.create({
        freelancerProfileId: input.profile.id,
        userId: input.profile.userId,
        eventType: input.eventType,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actorType: input.actorType,
        actorUserId: input.actorUserId ?? null,
        metadata: input.metadata ?? null,
      }),
    );
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message.slice(0, 1000);
    return 'Queue operation failed';
  }
}
