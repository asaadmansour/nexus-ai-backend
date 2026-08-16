export interface BudgetMilestoneInput {
  key: string;
  budgetAmount?: number | null;
  currency?: string | null;
}

export interface BudgetTaskInput {
  key: string;
  milestoneKey: string;
  estimatedHours?: number | null;
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
