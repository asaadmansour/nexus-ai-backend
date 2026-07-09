import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { FreelancersService } from './freelancers.service';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdateFreelancerDto } from './dtos/update-freelancer.dto';

@Controller('freelancers')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.FREELANCER)
export class FreelancersController {
  constructor(private readonly freelancersService: FreelancersService) {}

  @Get('me')
  async getMyProfile(@CurrentUser() user: any) {
    return await this.freelancersService.getMyProfile(user.sub);
  }

  @Patch('me')
  async updateMyProfile(@CurrentUser() user: any, @Body() dto: UpdateFreelancerDto) {
    return await this.freelancersService.updateMyProfile(user.sub, dto);
  }
}
