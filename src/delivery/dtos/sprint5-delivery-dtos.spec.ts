import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePaymentReleaseRequestDto } from 'src/payments/dtos/create-payment-release-request.dto';
import { ReviewPaymentReleaseRequestDto } from 'src/payments/dtos/review-payment-release-request.dto';
import { CreateRevisionRequestDto } from './create-revision-request.dto';
import { CreateSubmissionDto } from './create-submission.dto';
import { ReviewSubmissionDto } from './review-submission.dto';

const UUID = 'd4b7e8cc-53e0-4b06-95bc-b8a31df86474';

describe('Sprint 5 delivery DTOs', () => {
  it('accepts a valid submitted pull-request payload', async () => {
    const dto = plainToInstance(CreateSubmissionDto, {
      taskId: UUID,
      submissionType: 'pull_request',
      pullRequestUrl: 'https://github.com/nexus-ai/example/pull/4',
      summary: 'Implemented and tested the checkout API.',
      status: 'submitted',
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects submission state escalation and a missing task id', async () => {
    const dto = plainToInstance(CreateSubmissionDto, {
      submissionType: 'text',
      status: 'approved',
    });

    const properties = (await validate(dto)).map((error) => error.property);
    expect(properties).toEqual(expect.arrayContaining(['taskId', 'status']));
  });

  it('validates final review decisions and score bounds', async () => {
    const valid = plainToInstance(ReviewSubmissionDto, {
      decision: 'changes_requested',
      score: 72,
      createRevisionRequest: true,
    });
    const invalid = plainToInstance(ReviewSubmissionDto, {
      decision: 'commented',
      score: 120,
    });

    expect(await validate(valid)).toHaveLength(0);
    expect((await validate(invalid)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['decision', 'score']),
    );
  });

  it('validates nested criterion ratings on the 1-to-5 scale', async () => {
    const valid = plainToInstance(ReviewSubmissionDto, {
      decision: 'approved',
      feedback: 'The implementation meets the reviewed requirements.',
      criteriaReviews: [
        {
          criterionKey: 'acceptance_1',
          rating: 5,
          comment: 'Verified against the acceptance example.',
        },
      ],
    });
    const invalid = plainToInstance(ReviewSubmissionDto, {
      decision: 'rejected',
      criteriaReviews: [
        {
          criterionKey: 'acceptance_1',
          rating: 6,
        },
      ],
    });

    expect(await validate(valid)).toHaveLength(0);
    expect((await validate(invalid))[0]?.children?.[0]?.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'rating' })]),
    );
  });

  it('requires a positive, three-letter release amount and currency', async () => {
    const dto = plainToInstance(CreatePaymentReleaseRequestDto, {
      submissionId: UUID,
      amount: 0,
      currency: 'EGYP',
    });

    expect((await validate(dto)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['amount', 'currency']),
    );
  });

  it('accepts only approve or reject release decisions', async () => {
    const dto = plainToInstance(ReviewPaymentReleaseRequestDto, {
      decision: 'released',
      releaseNow: true,
    });

    expect((await validate(dto)).map((error) => error.property)).toContain(
      'decision',
    );
  });

  it('validates revision priority and due date', async () => {
    const dto = plainToInstance(CreateRevisionRequestDto, {
      taskId: UUID,
      title: 'Add duplicate webhook tests',
      priority: 'critical',
      dueAt: 'next week',
    });

    expect((await validate(dto)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['priority', 'dueAt']),
    );
  });
});
