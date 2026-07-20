import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { Project } from 'src/projects/entities/project.entity';
import { User } from 'src/users/entities/user.entity';
import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { ProjectPayment } from './entities/project-payment.entity';
import { StripeWebhookEvent } from './entities/stripe-webhook-event.entity';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

const repositoryMock = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(User), useFactory: repositoryMock },
        {
          provide: getRepositoryToken(FreelancerProfile),
          useFactory: repositoryMock,
        },
        { provide: getRepositoryToken(Project), useFactory: repositoryMock },
        {
          provide: getRepositoryToken(ProjectMilestone),
          useFactory: repositoryMock,
        },
        {
          provide: getRepositoryToken(ProjectPayment),
          useFactory: repositoryMock,
        },
        {
          provide: getRepositoryToken(EscrowLedgerEntry),
          useFactory: repositoryMock,
        },
        {
          provide: getRepositoryToken(StripeWebhookEvent),
          useFactory: repositoryMock,
        },
        { provide: StripeService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
