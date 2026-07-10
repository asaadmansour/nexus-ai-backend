import {
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
  Body,
  ForbiddenException,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserService } from './users.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdateUserDto } from './dtos/update-user.dto';
import { UserRole } from 'src/common/enums/user-role.enum';

const MAX_CV_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PHOTO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

@Controller('users')
export class UsersController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user) {
    return await this.userService.findMe(user.sub);
  }

  @UseGuards(AuthGuard)
  @Patch('me')
  async updateMe(@CurrentUser() user, @Body() updated: UpdateUserDto) {
    return await this.userService.updateMe(updated, user.sub);
  }
}

@Controller('uploads')
export class UploadsController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
  @Roles(UserRole.FREELANCER)
  @Post('freelancer-cv')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(), // keep file in RAM — never written to disk
      limits: { fileSize: MAX_CV_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(
            new BadRequestException('Only PDF files are allowed'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadCv(
    @CurrentUser() user,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return await this.userService.uploadAndSaveCv(user.sub, file);
  }

  @UseGuards(AuthGuard, VerifiedGuard)
  @Post('profile-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              'Only JPEG, PNG, and WebP images are allowed',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadPhoto(
    @CurrentUser() user,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return await this.userService.uploadAndSavePhoto(user.sub, file);
  }
}
