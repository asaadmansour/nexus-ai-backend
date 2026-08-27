import { AutomationIncidentsService } from './automation-incidents.service';
import { AutomationIncident } from './entities/automation-incident.entity';

describe('AutomationIncidentsService', () => {
  const incidentId = '11111111-1111-4111-8111-111111111111';

  function setup(existing: AutomationIncident | null = null) {
    const incidentRepo = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn((value: Record<string, unknown>) =>
        Promise.resolve({ id: incidentId, ...value }),
      ),
    };
    const eventRepo = {
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn((value: Record<string, unknown>) =>
        Promise.resolve({ id: 'event-id', ...value }),
      ),
    };
    const userRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'admin-id' }]),
    };
    const notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AutomationIncidentsService(
      incidentRepo as never,
      eventRepo as never,
      userRepo as never,
      notifications as never,
    );
    return { service, incidentRepo, eventRepo, notifications };
  }

  it('creates a trace event, redacts secrets, and links the admin notification', async () => {
    const { service, incidentRepo, eventRepo, notifications } = setup();

    await service.record({
      subsystem: 'repositories',
      operation: 'provision_project',
      projectId: '22222222-2222-4222-8222-222222222222',
      errorCode: 'github_failed',
      message: 'GitHub rejected the request',
      context: {
        repositoryId: 'repo-id',
        nested: { apiKey: 'must-not-be-stored', safe: 'visible' },
      },
      trace: 'Error: failed\nAuthorization: Bearer super-secret-token',
    });

    expect(incidentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          repositoryId: 'repo-id',
          nested: { safe: 'visible' },
        },
      }),
    );
    expect(eventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId,
        eventType: 'occurred',
        trace: expect.not.stringContaining('super-secret-token'),
      }),
    );
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-id',
        type: 'automation_incident',
        actionUrl: `/dashboard/admin/automation-incidents/${incidentId}`,
        metadata: expect.objectContaining({ incidentId }),
      }),
    );
  });

  it('records another occurrence without sending duplicate open alerts', async () => {
    const existing = {
      id: incidentId,
      status: 'open',
      severity: 'error',
      message: 'first failure',
      context: null,
      occurrenceCount: 1,
      firstOccurredAt: new Date('2026-08-20T00:00:00Z'),
      lastOccurredAt: new Date('2026-08-20T00:00:00Z'),
      resolvedAt: null,
      resolutionNote: null,
    } as AutomationIncident;
    const { service, eventRepo, notifications } = setup(existing);

    await service.record({
      subsystem: 'matching',
      operation: 'reconcile',
      errorCode: 'scan_failed',
      message: 'still failing',
    });

    expect(existing.occurrenceCount).toBe(2);
    expect(eventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'occurred' }),
    );
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });
});
