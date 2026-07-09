import { Controller, Get, Patch, UseGuards, Body } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { UserService } from './users.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdateUserDto } from './dtos/update-user.dto';

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
