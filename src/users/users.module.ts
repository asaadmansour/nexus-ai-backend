import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { RedisModule } from 'src/redis/redis.module';
import { UserService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), RedisModule],
  exports: [TypeOrmModule],
  controllers: [UsersController],
  providers: [UserService],
})
export class UsersModule {}
