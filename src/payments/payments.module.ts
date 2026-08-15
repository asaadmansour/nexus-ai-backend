import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { PaymentReleaseRequest } from './entities/payment-release-request.entity';
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
import { MatchingModule } from 'src/matching/matching.module';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { PaymentReleaseRequestsService } from './payment-release-requests.service';
import {
  AdminPaymentReleaseRequestsController,
  PaymentReleaseRequestDetailController,
  ProjectPaymentReleaseRequestsController,
} from './payment-release-requests.controller';

@Module({
  imports: [
    MatchingModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      ProjectPayment,
      PaymentReleaseRequest,
      EscrowLedgerEntry,
      StripeWebhookEvent,
      User,
      FreelancerProfile,
      Project,
      ProjectMilestone,
      ProjectTask,
      ProjectSubmission,
    ]),
  ],
  exports: [TypeOrmModule, PaymentReleaseRequestsService],
  providers: [PaymentsService, StripeService, PaymentReleaseRequestsService],
  controllers: [
    PaymentsController,
    StripeWebhookController,
    ProjectPaymentReleaseRequestsController,
    AdminPaymentReleaseRequestsController,
    PaymentReleaseRequestDetailController,
  ],
})
export class PaymentsModule {}
