import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { Repository } from 'typeorm';
import { UpdateUserDto } from './dtos/update-user.dto';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sanitizeUser } from 'src/common/utils/sanitize-user.util';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(FreelancerProfile)
    private readonly freelancerProfileRepository: Repository<FreelancerProfile>,
    private readonly configService: ConfigService,
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
      await this.freelancerProfileRepository.upsert(
        { userId, cvUrl: cvResult.secure_url },
        { conflictPaths: ['userId'], skipUpdateIfNoValuesChanged: true },
      );

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
}
