import { BriefService } from './brief.service';

type BriefFieldSanitizer = {
  sanitizeExtractedFields: (
    fields: Record<string, unknown>,
    latestMessage: string,
    pendingField: string | null,
  ) => Record<string, unknown>;
};

describe('BriefService out-of-order answer routing', () => {
  const service = Object.create(
    BriefService.prototype,
  ) as unknown as BriefFieldSanitizer;

  it('keeps a concrete answer on its extracted field instead of crediting the pending field', () => {
    const result = service.sanitizeExtractedFields(
      { coreFeatures: ['appointment booking', 'email reminders'] },
      'The must-have features are appointment booking and email reminders.',
      'targetUsers',
    );

    expect(result.coreFeatures).toEqual([
      'appointment booking',
      'email reminders',
    ]);
    expect(result.targetUsers).toBeUndefined();
  });

  it('still uses the deterministic fallback for a direct pending-field answer', () => {
    const result = service.sanitizeExtractedFields(
      {},
      'Patients, reception staff, and clinic managers.',
      'targetUsers',
    );

    expect(result.targetUsers).toBe(
      'Patients, reception staff, and clinic managers.',
    );
  });
});
