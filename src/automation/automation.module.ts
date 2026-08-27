import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAutomationIncidentsController } from './admin-automation-incidents.controller';
import { AutomationIncidentsService } from './automation-incidents.service';
import { AutomationIncident } from './entities/automation-incident.entity';
import { AutomationIncidentEvent } from './entities/automation-incident-event.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { User } from 'src/users/entities/user.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AutomationIncident,
      AutomationIncidentEvent,
      User,
    ]),
    NotificationsModule,
  ],
  controllers: [AdminAutomationIncidentsController],
  providers: [AutomationIncidentsService],
  exports: [AutomationIncidentsService],
})
export class AutomationModule {}
