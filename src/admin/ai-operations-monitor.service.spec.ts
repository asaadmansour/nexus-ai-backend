import { deriveAiOperationsStatus } from './ai-operations-monitor.service';

describe('AI operations health policy', () => {
  it('is healthy without stale or failed jobs', () => {
    expect(deriveAiOperationsStatus(0, 0, 0, 3)).toBe('healthy');
  });

  it('degrades for queued backlog or isolated failures', () => {
    expect(deriveAiOperationsStatus(1, 0, 0, 3)).toBe('degraded');
    expect(deriveAiOperationsStatus(0, 0, 1, 3)).toBe('degraded');
  });

  it('fails for a stuck worker or the configured failure threshold', () => {
    expect(deriveAiOperationsStatus(0, 1, 0, 3)).toBe('failing');
    expect(deriveAiOperationsStatus(0, 0, 3, 3)).toBe('failing');
  });
});
