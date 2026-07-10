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

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(FreelancerProfile)
    private readonly freelancerProfileRepository: Repository<FreelancerProfile>,
  ) {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('Missing Cloudinary Configs');
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
    
    const { hashedPassword: _hashedPassword, ...safeUser } = user;
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
    // Upload buffer directly to Cloudinary (no temp file on disk)
    const cvResult = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw', // required for non-image types like PDF
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
      const user = await this.userRepository.findOne({ where: { id: userId }, relations: ['freelancerProfile']});
      if (user?.freelancerProfile?.cvUrl) {
         const oldUrlMatch = user.freelancerProfile.cvUrl.match(/cvs\/[^/]+$/);
         if (oldUrlMatch) {
            cloudinary.uploader.destroy(oldUrlMatch[0], { resource_type: 'raw' }).catch(console.error);
         }
      }

      await this.freelancerProfileRepository.upsert(
        { userId, cvUrl: cvResult.secure_url },
        { conflictPaths: ['userId'], skipUpdateIfNoValuesChanged: true },
      );
      return { status: 'success', cvUrl: cvResult.secure_url };
    } catch (dbError) {
      cloudinary.uploader.destroy(cvResult.public_id, { resource_type: 'raw' }).catch(console.error);
      throw dbError;
    }
  }

  async uploadAndSavePhoto(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ status: string; photoUrl: string }> {
    const photoResult = await new Promise<UploadApiResponse>((resolve, reject) => {
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
    });

    try {
      const user = await this.userRepository.findOne({ where: { id: userId }});
      if (user?.photoUrl) {
         const oldUrlMatch = user.photoUrl.match(/avatars\/[^/]+$/);
         if (oldUrlMatch) {
            cloudinary.uploader.destroy(oldUrlMatch[0]).catch(console.error);
         }
      }
      await this.userRepository.update({ id: userId }, { photoUrl: photoResult.secure_url });
      return { status: 'success', photoUrl: photoResult.secure_url };
    } catch (dbError) {
      cloudinary.uploader.destroy(photoResult.public_id).catch(console.error);
      throw dbError;
    }
  }
}
