export interface BudgetMilestoneInput {
  key: string;
  budgetAmount?: number | null;
  currency?: string | null;
}

export interface BudgetTaskInput {
  key: string;
  milestoneKey: string;
  estimatedHours?: number | null;
  priority?: string | null;
  requiredSkills?: string[] | null;
  complexity?: string | null;
}

/**
 * Allocates one authoritative implementation pool across every task. Hours are
 * the base effort signal, while priority and task breadth provide modest
 * complexity adjustments. The exact-cent invariant is the same as the legacy
 * milestone allocator: allocations always add back to the supplied pool.
 */
export function allocateProjectTaskBudgets(
  implementationAmount: number | string,
  tasks: BudgetTaskInput[],
  currencyValue: string,
): Map<string, TaskBudgetAllocation> {
  const currency = currencyValue.trim().toUpperCase();
  const totalCents = Math.round(Number(implementationAmount) * 100);
  if (
    !tasks.length ||
    !Number.isFinite(totalCents) ||
    totalCents < 0 ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return new Map(
      tasks.map((task) => [task.key, { amount: null, currency: null }]),
    );
  }

  const weights = tasks.map(taskComplexityWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = tasks.map((task, index) => {
    const exactCents = (totalCents * weights[index]) / totalWeight;
    const cents = Math.floor(exactCents);
    return { task, cents, remainder: exactCents - cents, index };
  });
  let centsLeft =
    totalCents - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort(
    (left, right) =>
      right.remainder - left.remainder || left.index - right.index,
  )) {
    if (centsLeft <= 0) break;
    share.cents += 1;
    centsLeft -= 1;
  }

  return new Map(
    shares.map((share) => [
      share.task.key,
      { amount: (share.cents / 100).toFixed(2), currency },
    ]),
  );
}

function taskComplexityWeight(task: BudgetTaskInput) {
  const hours = Number(task.estimatedHours);
  const effort = Number.isFinite(hours) && hours > 0 ? hours : 1;
  const priorityMultiplier: Record<string, number> = {
    low: 0.9,
    medium: 1,
    high: 1.15,
    critical: 1.3,
    urgent: 1.3,
  };
  const declaredComplexity: Record<string, number> = {
    trivial: 0.85,
    simple: 0.9,
    standard: 1,
    medium: 1,
    complex: 1.2,
    high: 1.2,
  };
  const skillCount = new Set(
    (task.requiredSkills ?? [])
      .map((skill) => skill.trim().toLowerCase())
      .filter(Boolean),
  ).size;
  const breadthMultiplier = 1 + Math.min(skillCount, 5) * 0.04;
  return (
    effort *
    (priorityMultiplier[task.priority?.toLowerCase() ?? ''] ?? 1) *
    (declaredComplexity[task.complexity?.toLowerCase() ?? ''] ?? 1) *
    breadthMultiplier
  );
}

export interface TaskBudgetAllocation {
  amount: string | null;
  currency: string | null;
}

/**
 * Splits every milestone budget across its tasks using estimated hours. Money
 * is handled in integer cents and remaining cents go to the largest fractional
 * shares, so task allocations always add back to the exact milestone budget.
 */
export function allocateTaskBudgets(
  milestones: BudgetMilestoneInput[],
  tasks: BudgetTaskInput[],
  fallbackCurrency?: string | null,
): Map<string, TaskBudgetAllocation> {
  const result = new Map<string, TaskBudgetAllocation>();
  const tasksByMilestone = new Map<string, BudgetTaskInput[]>();

  for (const task of tasks) {
    tasksByMilestone.set(task.milestoneKey, [
      ...(tasksByMilestone.get(task.milestoneKey) ?? []),
      task,
    ]);
  }

  for (const milestone of milestones) {
    const milestoneTasks = tasksByMilestone.get(milestone.key) ?? [];
    const budget =
      milestone.budgetAmount == null ? null : Number(milestone.budgetAmount);
    const currency =
      milestone.currency?.trim().toUpperCase() ||
      fallbackCurrency?.trim().toUpperCase() ||
      null;
    if (
      !milestoneTasks.length ||
      budget === null ||
      !Number.isFinite(budget) ||
      budget < 0 ||
      !currency
    ) {
      for (const task of milestoneTasks) {
        result.set(task.key, { amount: null, currency: null });
      }
      continue;
    }

    const totalCents = Math.round(budget * 100);
    const weights = milestoneTasks.map((task) => {
      const estimatedHours = Number(task.estimatedHours);
      return Number.isFinite(estimatedHours) && estimatedHours > 0
        ? estimatedHours
        : 1;
    });
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const shares = milestoneTasks.map((task, index) => {
      const exactCents = (totalCents * weights[index]) / totalWeight;
      const cents = Math.floor(exactCents);
      return {
        task,
        cents,
        remainder: exactCents - cents,
        index,
      };
    });
    let centsLeft =
      totalCents - shares.reduce((sum, share) => sum + share.cents, 0);
    const byRemainder = [...shares].sort(
      (left, right) =>
        right.remainder - left.remainder || left.index - right.index,
    );
    for (const share of byRemainder) {
      if (centsLeft <= 0) break;
      share.cents += 1;
      centsLeft -= 1;
    }

    for (const share of shares) {
      result.set(share.task.key, {
        amount: (share.cents / 100).toFixed(2),
        currency,
      });
    }
  }

  for (const task of tasks) {
    if (!result.has(task.key)) {
      result.set(task.key, { amount: null, currency: null });
    }
  }
  return result;
}
