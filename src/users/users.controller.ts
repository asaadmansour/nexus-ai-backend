import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { UserService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly userService: UserService) {}
  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@Req() request) {
    return await this.userService.findMe(request.sub);
  }
}
