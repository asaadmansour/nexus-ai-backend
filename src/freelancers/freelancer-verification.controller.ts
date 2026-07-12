import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { FreelancerVerificationService } from './freelancer-verification.service';

@Controller('freelancer-verification')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.FREELANCER)
export class FreelancerVerificationController {
  constructor(
    private readonly verificationService: FreelancerVerificationService,
  ) {}

  @Get('me')
  async getMyVerification(@CurrentUser() user: JwtPayload) {
    return await this.verificationService.getMyVerification(user.sub);
  }
}
