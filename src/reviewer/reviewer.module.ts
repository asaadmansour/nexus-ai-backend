import { Module } from '@nestjs/common';
import { DeliveryModule } from 'src/delivery/delivery.module';
import { MatchingModule } from 'src/matching/matching.module';
import { PaymentsModule } from 'src/payments/payments.module';
import { PlanningModule } from 'src/planning/planning.module';
import { ReviewerController } from './reviewer.controller';
import { ReviewerService } from './reviewer.service';

@Module({
  imports: [PlanningModule, MatchingModule, DeliveryModule, PaymentsModule],
  controllers: [ReviewerController],
  providers: [ReviewerService],
})
export class ReviewerModule {}
