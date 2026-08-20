import {
  createProjectBudgetAllocation,
  planningRoleAllocation,
  requiredProjectTotalForRate,
} from './project-budget-allocation';

describe('project budget allocation', () => {
  it('splits a standard project across fee, governance, planning, and implementation', () => {
    const allocation = createProjectBudgetAllocation(
      1000,
      'egp',
      'standard',
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(allocation.platformFee.amount).toBe('100.00');
    expect(allocation.governance.principalReviewer.amount).toBe('100.00');
    expect(allocation.planning.architect.amount).toBe('150.00');
    expect(allocation.planning.ui_ux.amount).toBe('150.00');
    expect(allocation.implementation.amount).toBe('500.00');
    expect(allocation.currency).toBe('EGP');
    expect(planningRoleAllocation(allocation, 'architect')?.amount).toBe(
      '150.00',
    );
  });

  it('keeps odd cents and calculates the total required by a selected rate', () => {
    const allocation = createProjectBudgetAllocation(10.01, 'USD', 'trivial');
    const total =
      Number(allocation.platformFee.amount) +
      Number(allocation.governance.principalReviewer.amount) +
      Number(allocation.planning.architect.amount) +
      Number(allocation.planning.ui_ux.amount) +
      Number(allocation.implementation.amount);
    expect(total).toBeCloseTo(10.01, 2);
    expect(requiredProjectTotalForRate(100, 'architect', 4)).toBe('2666.67');
  });

  it('allocates the labor pool from the quoted role costs', () => {
    const allocation = createProjectBudgetAllocation(
      1000,
      'EGP',
      'standard',
      new Date('2026-01-01T00:00:00.000Z'),
      {},
      [
        {
          roleKey: 'principal_reviewer',
          people: 1,
          hoursEach: 5,
          hourlyRate: 10,
        },
        {
          roleKey: 'architect',
          people: 1,
          hoursEach: 10,
          hourlyRate: 10,
        },
        {
          roleKey: 'ui_ux',
          people: 1,
          hoursEach: 15,
          hourlyRate: 10,
        },
        {
          roleKey: 'implementation',
          people: 2,
          hoursEach: 30,
          hourlyRate: 10,
        },
      ],
    );

    expect(allocation.platformFee.amount).toBe('100.00');
    expect(allocation.governance.principalReviewer.amount).toBe('50.00');
    expect(allocation.planning.architect.amount).toBe('100.00');
    expect(allocation.planning.ui_ux.amount).toBe('150.00');
    expect(allocation.implementation.amount).toBe('600.00');
    expect(allocation.implementation.people).toBe(2);
    expect(allocation.implementation.estimatedHours).toBe(60);
    expect(allocation.minimumRecommendedAmount).toBe('1000.00');
  });
});
