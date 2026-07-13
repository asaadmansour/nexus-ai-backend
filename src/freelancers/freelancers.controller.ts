import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { FreelancersService } from './freelancers.service';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdateFreelancerDto } from './dtos/update-freelancer.dto';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';

@Controller('freelancers')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.FREELANCER)
export class FreelancersController {
  constructor(private readonly freelancersService: FreelancersService) {}

  @Get('me')
  async getMyProfile(@CurrentUser() user: JwtPayload) {
    return await this.freelancersService.getMyProfile(user.sub);
  }

  @Patch('me')
  async updateMyProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateFreelancerDto,
  ) {
    return await this.freelancersService.updateMyProfile(user.sub, dto);
  }

  @Get(':id')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  async getPublicProfile(@Param('id') id: string) {
    return await this.freelancersService.getPublicProfile(id);
  }
}
