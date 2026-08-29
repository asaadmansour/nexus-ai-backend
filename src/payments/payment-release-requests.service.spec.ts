import { UserRole } from 'src/common/enums/user-role.enum';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { PaymentReleaseRequestsService } from './payment-release-requests.service';

describe('PaymentReleaseRequestsService automatic integration release', () => {
  it('uses a system-authorized identity while preserving the approving user audit id', async () => {
    const submission = { id: 'submission-id' } as ProjectSubmission;
    const request = { id: 'release-id' };
    const createForApprovedSubmission = jest.fn().mockResolvedValue(request);
    const review = jest.fn().mockResolvedValue({ releaseRequest: request });
    const service = Object.create(
      PaymentReleaseRequestsService.prototype,
    ) as PaymentReleaseRequestsService;
    Object.assign(service as unknown as Record<string, unknown>, {
      createForApprovedSubmission,
      review,
    });

    await service.releaseApprovedSubmission(submission, 'reviewer-user-id');

    expect(createForApprovedSubmission).toHaveBeenCalledWith(submission, {
      sub: 'reviewer-user-id',
      role: UserRole.ADMIN,
    });
    expect(review).toHaveBeenCalledWith(
      'release-id',
      expect.objectContaining({ decision: 'approved', releaseNow: true }),
      { sub: 'reviewer-user-id', role: UserRole.ADMIN },
    );
  });
});
