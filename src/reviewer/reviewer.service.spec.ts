import { ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { ProjectPlanningSubmission } from 'src/projects/entities/project-planning-submission.entity';
import { ReviewerService } from './reviewer.service';

describe('ReviewerService planning evaluation retry', () => {
  function harness(isPrincipalReviewer: boolean) {
    const findOne = jest.fn().mockResolvedValue({
      id: 'submission-id',
      projectId: 'project-id',
    });
    const dataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === ProjectPlanningSubmission) return { findOne };
        throw new Error('Unexpected repository');
      }),
    } as unknown as DataSource;
    const retry = jest.fn().mockResolvedValue({ status: 'queued' });
    const matching = {
      isPrincipalReviewer: jest.fn().mockResolvedValue(isPrincipalReviewer),
    };
    const service = new ReviewerService(
      dataSource,
      {} as never,
      { retry } as never,
      {} as never,
      matching as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, findOne, retry, matching };
  }

  it('lets the assigned principal reviewer retry a failed evaluation', async () => {
    const { service, retry, matching } = harness(true);

    await expect(
      service.retryPlanningSubmissionEvaluation('submission-id', 'reviewer-id'),
    ).resolves.toEqual({ status: 'queued' });

    expect(matching.isPrincipalReviewer).toHaveBeenCalledWith(
      'reviewer-id',
      'project-id',
    );
    expect(retry).toHaveBeenCalledWith('submission-id', 'reviewer-id');
  });

  it('does not expose retry to an unrelated freelancer', async () => {
    const { service, retry } = harness(false);

    await expect(
      service.retryPlanningSubmissionEvaluation(
        'submission-id',
        'other-user-id',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(retry).not.toHaveBeenCalled();
  });
});
