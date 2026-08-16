import {
  createProjectBudgetAllocation,
  planningRoleAllocation,
  requiredProjectTotalForRate,
} from './project-budget-allocation';

describe('project budget allocation', () => {
  it('splits a 1000 EGP project into 250/250/500 exactly', () => {
    const allocation = createProjectBudgetAllocation(
      1000,
      'egp',
      'standard',
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(allocation.planning.architect.amount).toBe('250.00');
    expect(allocation.planning.ui_ux.amount).toBe('250.00');
    expect(allocation.implementation.amount).toBe('500.00');
    expect(allocation.currency).toBe('EGP');
    expect(planningRoleAllocation(allocation, 'architect')?.amount).toBe(
      '250.00',
    );
  });

  it('keeps odd cents and calculates the total required by a selected rate', () => {
    const allocation = createProjectBudgetAllocation(10.01, 'USD', 'trivial');
    const total =
      Number(allocation.planning.architect.amount) +
      Number(allocation.planning.ui_ux.amount) +
      Number(allocation.implementation.amount);
    expect(total).toBe(10.01);
    expect(requiredProjectTotalForRate(100, 'architect', 4)).toBe('1600.00');
  });
});
