import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './users/users.module';
import { FreelancersModule } from './freelancers/freelancers.module';
import { ProjectsModule } from './projects/projects.module';
import { AuthModule } from './auth/auth.module';
import { RedisModule } from './redis/redis.module';
import { AgentsModule } from './agents/agents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EmailModule } from './email/email.module';
import { AdminModule } from './admin/admin.module';
import { SearchModule } from './search/search.module';
import { MatchingModule } from './matching/matching.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { PlanningModule } from './planning/planning.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    UsersModule,
    FreelancersModule,
    ProjectsModule,
    AuthModule,
    RedisModule,
    AgentsModule,
    NotificationsModule,
    EmailModule,
    AdminModule,
    SearchModule,
    MatchingModule,
    AssignmentsModule,
    PlanningModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
