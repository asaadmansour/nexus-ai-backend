import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { BriefService } from './brief.service';
import { CreateBriefMessageDto } from './dtos/create-brief-message.dto';
import { UpdateBriefDto } from './dtos/update-brief.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';

const MAX_REQUIREMENTS_DOCUMENT_BYTES = 10 * 1024 * 1024;
const REQUIREMENTS_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'application/json',
]);

@Controller('projects/:projectId/brief')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class BriefController {
  constructor(private readonly briefService: BriefService) {}

  @Get()
  @Roles(UserRole.CUSTOMER)
  getBrief(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.getBrief(projectId, user.sub, false);
  }

  @Get('messages')
  @Roles(UserRole.CUSTOMER)
  getMessages(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.getMessages(projectId, user.sub, false);
  }

  @Get('documents')
  @Roles(UserRole.CUSTOMER)
  getDocuments(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.getDocuments(projectId, user.sub, false);
  }

  @Get('documents/:documentId/download')
  @Roles(UserRole.CUSTOMER)
  getDocumentDownload(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.getDocumentDownload(
      projectId,
      documentId,
      user.sub,
      false,
    );
  }

  @Post('documents')
  @Roles(UserRole.CUSTOMER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_REQUIREMENTS_DOCUMENT_BYTES },
      fileFilter: (_request, file, callback) => {
        const mimeType = file.mimetype.toLowerCase().split(';', 1)[0];
        if (!REQUIREMENTS_DOCUMENT_MIME_TYPES.has(mimeType)) {
          callback(
            new BadRequestException(
              'Requirements documents must be PDF, DOCX, TXT, Markdown, or JSON files',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  uploadDocument(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file)
      throw new BadRequestException('No requirements document uploaded');
    return this.briefService.uploadDocument(projectId, user.sub, false, file);
  }

  @Post('messages')
  @Roles(UserRole.CUSTOMER)
  sendMessage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateBriefMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.sendCustomerMessage(
      projectId,
      user.sub,
      false,
      dto,
    );
  }

  @Patch()
  @Roles(UserRole.CUSTOMER)
  updateBrief(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateBriefDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.updateBrief(projectId, user.sub, false, dto);
  }

  @Post('reopen')
  @Roles(UserRole.CUSTOMER)
  reopenAiHelp(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.reopenAiHelp(projectId, user.sub, false);
  }

  @Post('confirm')
  @Roles(UserRole.CUSTOMER)
  confirmBrief(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.confirmBrief(projectId, user.sub, false);
  }
}
