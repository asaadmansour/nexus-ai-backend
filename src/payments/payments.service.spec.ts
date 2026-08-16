import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { User } from 'src/users/entities/user.entity';
import { MatchingService } from 'src/matching/matching.service';
import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { ProjectPayment } from './entities/project-payment.entity';
import { PaymentReleaseRequest } from './entities/payment-release-request.entity';
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
  let freelancerProfilesRepository: ReturnType<typeof repositoryMock>;
  let tasksRepository: ReturnType<typeof repositoryMock>;
  let submissionsRepository: ReturnType<typeof repositoryMock>;
  let releaseRequestsRepository: ReturnType<typeof repositoryMock>;
  let ledgerRepository: ReturnType<typeof repositoryMock>;

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
          provide: getRepositoryToken(ProjectTask),
          useFactory: repositoryMock,
        },
        {
          provide: getRepositoryToken(ProjectSubmission),
          useFactory: repositoryMock,
        },
        {
          provide: getRepositoryToken(PaymentReleaseRequest),
          useFactory: repositoryMock,
        },
        {
          provide: getRepositoryToken(StripeWebhookEvent),
          useFactory: repositoryMock,
        },
        { provide: StripeService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MatchingService, useValue: {} },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    freelancerProfilesRepository = module.get(
      getRepositoryToken(FreelancerProfile),
    );
    tasksRepository = module.get(getRepositoryToken(ProjectTask));
    submissionsRepository = module.get(getRepositoryToken(ProjectSubmission));
    releaseRequestsRepository = module.get(
      getRepositoryToken(PaymentReleaseRequest),
    );
    ledgerRepository = module.get(getRepositoryToken(EscrowLedgerEntry));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns task allocations and approved earnings without requiring Stripe', async () => {
    freelancerProfilesRepository.findOne.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      stripeAccountId: null,
      stripeOnboardingStatus: 'not_started',
    });
    tasksRepository.find.mockResolvedValue([
      {
        id: 'task-approved',
        budgetAmount: '66.67',
        currency: 'EGP',
      },
      { id: 'task-open', budgetAmount: '33.33', currency: 'EGP' },
    ]);
    submissionsRepository.find.mockResolvedValue([{ taskId: 'task-approved' }]);
    releaseRequestsRepository.find.mockResolvedValue([
      { amount: '66.67', currency: 'EGP' },
    ]);
    ledgerRepository.find.mockResolvedValue([
      { amount: '10.00', currency: 'EGP' },
    ]);

    const result = await service.getFreelancerAccount('user-1');

    expect(result.data.earnings.currencies).toEqual([
      {
        currency: 'EGP',
        allocatedAmount: '100.00',
        approvedAmount: '66.67',
        pendingReleaseAmount: '66.67',
        releasedAmount: '10.00',
      },
    ]);
    expect(result.data.accountId).toBeNull();
  });
});
