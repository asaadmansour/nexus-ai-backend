import { Injectable } from '@nestjs/common';
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
    return {
      status: 'updated successfully',
    };
  }
}
