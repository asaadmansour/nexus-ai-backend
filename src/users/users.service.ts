import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { Repository } from 'typeorm';
import { UpdateUserDto } from './dtos/update-user.dto';
@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}
  async findMe(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('No User found');
    return {
      status: 'success',
      user: user,
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
}
