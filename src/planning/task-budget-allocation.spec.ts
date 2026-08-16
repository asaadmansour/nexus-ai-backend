import {
  allocateProjectTaskBudgets,
  allocateTaskBudgets,
} from './task-budget-allocation';

describe('allocateTaskBudgets', () => {
  it('allocates by estimated hours and preserves the exact milestone total', () => {
    const allocations = allocateTaskBudgets(
      [{ key: 'm1', budgetAmount: 100, currency: 'egp' }],
      [
        { key: 'small', milestoneKey: 'm1', estimatedHours: 1 },
        { key: 'large', milestoneKey: 'm1', estimatedHours: 2 },
      ],
    );

    expect(allocations.get('small')).toEqual({
      amount: '33.33',
      currency: 'EGP',
    });
    expect(allocations.get('large')).toEqual({
      amount: '66.67',
      currency: 'EGP',
    });
  });

  it('uses equal weights when estimates are missing and leaves unbudgeted tasks null', () => {
    const allocations = allocateTaskBudgets(
      [
        { key: 'funded', budgetAmount: 0.03, currency: 'USD' },
        { key: 'unknown', budgetAmount: null, currency: 'USD' },
      ],
      [
        { key: 'a', milestoneKey: 'funded' },
        { key: 'b', milestoneKey: 'funded' },
        { key: 'c', milestoneKey: 'unknown' },
      ],
    );

    expect(allocations.get('a')?.amount).toBe('0.02');
    expect(allocations.get('b')?.amount).toBe('0.01');
    expect(allocations.get('c')).toEqual({ amount: null, currency: null });
  });

  it('uses the project currency when a generated milestone omitted it', () => {
    const allocations = allocateTaskBudgets(
      [{ key: 'm1', budgetAmount: 10, currency: null }],
      [{ key: 'task', milestoneKey: 'm1' }],
      'EGP',
    );
    expect(allocations.get('task')).toEqual({
      amount: '10.00',
      currency: 'EGP',
    });
  });

  it('allocates the exact implementation pool using effort and complexity', () => {
    const allocations = allocateProjectTaskBudgets(
      500,
      [
        {
          key: 'simple',
          milestoneKey: 'm1',
          estimatedHours: 10,
          priority: 'medium',
          requiredSkills: ['React'],
        },
        {
          key: 'complex',
          milestoneKey: 'm2',
          estimatedHours: 10,
          priority: 'high',
          requiredSkills: ['NestJS', 'PostgreSQL', 'Security'],
        },
      ],
      'egp',
    );

    const simple = Number(allocations.get('simple')?.amount);
    const complex = Number(allocations.get('complex')?.amount);
    expect(simple + complex).toBe(500);
    expect(complex).toBeGreaterThan(simple);
    expect(allocations.get('complex')?.currency).toBe('EGP');
  });

  it('preserves rounding cents across many tasks', () => {
    const allocations = allocateProjectTaskBudgets(
      '0.05',
      [
        { key: 'a', milestoneKey: 'm' },
        { key: 'b', milestoneKey: 'm' },
        { key: 'c', milestoneKey: 'm' },
      ],
      'USD',
    );
    expect(
      [...allocations.values()].reduce(
        (sum, allocation) => sum + Number(allocation.amount),
        0,
      ),
    ).toBe(0.05);
  });
});
