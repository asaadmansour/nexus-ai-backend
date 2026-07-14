import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { FreelancerAssessmentsService } from './freelancer-assessments.service';

@Controller('freelancer-verification')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.FREELANCER)
export class FreelancerVerificationController {
  constructor(private readonly assessments: FreelancerAssessmentsService) {}

  @Get('me')
  async getMyVerification(@CurrentUser() user: JwtPayload) {
    const data = await this.assessments.getVerification(
      user.sub,
      user.isEmailVerified === true,
    );
    return { status: 'success', data };
  }

  @Post('me/cv-extraction/retry')
  async retryCvExtraction(@CurrentUser() user: JwtPayload) {
    const data = await this.assessments.retryCvExtraction(user.sub);
    return { status: 'success', data };
  }

  @Post('me/assessment-generation/retry')
  async retryAssessmentGeneration(@CurrentUser() user: JwtPayload) {
    const data = await this.assessments.retryAssessmentGeneration(user.sub);
    return { status: 'success', data };
  }
}
