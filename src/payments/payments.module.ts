import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { ProjectPayment } from './entities/project-payment.entity';
import { StripeWebhookEvent } from './entities/stripe-webhook-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectPayment,
      EscrowLedgerEntry,
      StripeWebhookEvent,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class PaymentsModule {}
