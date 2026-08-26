import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAutomationIncidentsController } from './admin-automation-incidents.controller';
import { AutomationIncidentsService } from './automation-incidents.service';
import { AutomationIncident } from './entities/automation-incident.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AutomationIncident])],
  controllers: [AdminAutomationIncidentsController],
  providers: [AutomationIncidentsService],
  exports: [AutomationIncidentsService],
})
export class AutomationModule {}
