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
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(FreelancerProfile)
    private readonly freelancerProfileRepository: Repository<FreelancerProfile>,
  ) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async findMe(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['freelancerProfile'],
    });
    if (!user) throw new NotFoundException('No User found');
    return {
      status: 'success',
      user: {
        ...user,
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
    const cvUrl = await new Promise<string>((resolve, reject) => {
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
          resolve(result.secure_url);
        },
      );
      uploadStream.end(file.buffer);
    });

    // Upsert freelancer profile with new CV URL
    await this.freelancerProfileRepository.upsert(
      { userId, cvUrl },
      { conflictPaths: ['userId'], skipUpdateIfNoValuesChanged: true },
    );

    return { status: 'success', cvUrl };
  }

  async uploadAndSavePhoto(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ status: string; photoUrl: string }> {
    const photoUrl = await new Promise<string>((resolve, reject) => {
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
          resolve(result.secure_url);
        },
      );
      uploadStream.end(file.buffer);
    });

    await this.userRepository.update({ id: userId }, { photoUrl });

    return { status: 'success', photoUrl };
  }
}
