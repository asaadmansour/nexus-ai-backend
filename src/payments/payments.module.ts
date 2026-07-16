import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { ProjectPayment } from './entities/project-payment.entity';
import { StripeWebhookEvent } from './entities/stripe-webhook-event.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { User } from 'src/users/entities/user.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { Project } from 'src/projects/entities/project.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectPayment,
      EscrowLedgerEntry,
      StripeWebhookEvent,
      User,
      FreelancerProfile,
      Project,
      ProjectMilestone,
    ]),
  ],
  exports: [TypeOrmModule],
  providers: [PaymentsService, StripeService],
  controllers: [PaymentsController, StripeWebhookController],
})
export class PaymentsModule {}
