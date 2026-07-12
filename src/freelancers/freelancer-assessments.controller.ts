import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { FreelancerAssessmentsService } from './freelancer-assessments.service';
import { StartAssessmentDto } from './dtos/start-assessment.dto';
import { SaveAssessmentAnswersDto } from './dtos/save-assessment-answers.dto';
import { SubmitAssessmentDto } from './dtos/submit-assessment.dto';
import { TrackAssessmentEventDto } from './dtos/track-assessment-event.dto';

@Controller('freelancer-assessments')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.FREELANCER)
export class FreelancerAssessmentsController {
  constructor(private readonly assessments: FreelancerAssessmentsService) {}

  @Post('start')
  async start(
    @CurrentUser() user: JwtPayload,
    @Body() dto: StartAssessmentDto,
  ) {
    const data = await this.assessments.start(user.sub, dto);
    return { status: 'success', data };
  }

  @Get('current')
  async current(@CurrentUser() user: JwtPayload) {
    const data = await this.assessments.getCurrent(user.sub);
    return { status: 'success', data };
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.assessments.getById(user.sub, id);
    return { status: 'success', data };
  }

  @Post(':id/answers')
  async saveAnswers(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveAssessmentAnswersDto,
  ) {
    const data = await this.assessments.saveAnswers(user.sub, id, dto);
    return { status: 'success', data };
  }

  @Post(':id/events')
  async trackEvent(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TrackAssessmentEventDto,
  ) {
    const data = await this.assessments.trackEvent(user.sub, id, dto);
    return { status: 'success', data };
  }

  @Post(':id/submit')
  async submit(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAssessmentDto,
  ) {
    const data = await this.assessments.submit(user.sub, id, dto);
    return { status: 'success', data };
  }
}
