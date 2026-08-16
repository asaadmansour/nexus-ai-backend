export const PROJECT_BUDGET_ALLOCATION_VERSION = 1;

export const PROJECT_BUDGET_PERCENTAGES = {
  architect: 25,
  ui_ux: 25,
  implementation: 50,
} as const;

export type PlanningBudgetRole = 'architect' | 'ui_ux';
export type ProjectBudgetComplexity = 'trivial' | 'standard' | 'complex';

export interface ProjectBudgetRoleAllocation {
  percentage: number;
  amount: string;
  estimatedHours: number;
  maxHourlyRate: string;
}

export interface ProjectBudgetAllocation extends Record<string, unknown> {
  version: number;
  strategy: 'planning_25_25_implementation_50';
  totalAmount: string;
  currency: string;
  complexity: ProjectBudgetComplexity;
  planning: Record<PlanningBudgetRole, ProjectBudgetRoleAllocation>;
  implementation: {
    percentage: number;
    amount: string;
  };
  generatedAt: string;
}

const PLANNING_HOURS: Record<ProjectBudgetComplexity, number> = {
  trivial: 4,
  standard: 16,
  complex: 32,
};

export function createProjectBudgetAllocation(
  totalAmount: number | string,
  currencyValue: string,
  complexity: ProjectBudgetComplexity = 'standard',
  generatedAt = new Date(),
): ProjectBudgetAllocation {
  const totalCents = toCents(totalAmount);
  if (totalCents <= 0) {
    throw new Error('Project budget allocation requires a positive total');
  }
  const currency = normalizeCurrency(currencyValue);
  const architectCents = Math.round(
    (totalCents * PROJECT_BUDGET_PERCENTAGES.architect) / 100,
  );
  const uiuxCents = Math.round(
    (totalCents * PROJECT_BUDGET_PERCENTAGES.ui_ux) / 100,
  );
  // The final bucket receives rounding residue, so the three buckets always
  // equal the quoted project price down to the cent.
  const implementationCents = totalCents - architectCents - uiuxCents;
  const estimatedHours = PLANNING_HOURS[complexity];

  return {
    version: PROJECT_BUDGET_ALLOCATION_VERSION,
    strategy: 'planning_25_25_implementation_50',
    totalAmount: fromCents(totalCents),
    currency,
    complexity,
    planning: {
      architect: roleAllocation(
        architectCents,
        PROJECT_BUDGET_PERCENTAGES.architect,
        estimatedHours,
      ),
      ui_ux: roleAllocation(
        uiuxCents,
        PROJECT_BUDGET_PERCENTAGES.ui_ux,
        estimatedHours,
      ),
    },
    implementation: {
      percentage: PROJECT_BUDGET_PERCENTAGES.implementation,
      amount: fromCents(implementationCents),
    },
    generatedAt: generatedAt.toISOString(),
  };
}

export function projectBudgetAllocation(
  value: Record<string, unknown> | null | undefined,
): ProjectBudgetAllocation | null {
  if (!value || value.version !== PROJECT_BUDGET_ALLOCATION_VERSION) {
    return null;
  }
  const candidate = value as ProjectBudgetAllocation;
  const planning = candidate.planning;
  if (
    candidate.strategy !== 'planning_25_25_implementation_50' ||
    !planning?.architect ||
    !planning.ui_ux ||
    !candidate.implementation ||
    toCents(candidate.totalAmount) <= 0 ||
    !candidate.currency
  ) {
    return null;
  }
  return candidate;
}

export function planningRoleAllocation(
  value: Record<string, unknown> | null | undefined,
  roleKey: string,
) {
  const allocation = projectBudgetAllocation(value);
  if (!allocation || (roleKey !== 'architect' && roleKey !== 'ui_ux')) {
    return null;
  }
  return allocation.planning[roleKey];
}

export function implementationBudgetAmount(
  value: Record<string, unknown> | null | undefined,
) {
  const allocation = projectBudgetAllocation(value);
  return allocation ? Number(allocation.implementation.amount) : null;
}

export function requiredProjectTotalForRate(
  hourlyRate: number | string,
  roleKey: PlanningBudgetRole,
  estimatedHours: number,
) {
  const rateCents = toCents(hourlyRate);
  const roleCostCents = rateCents * estimatedHours;
  const percentage = PROJECT_BUDGET_PERCENTAGES[roleKey];
  return fromCents(Math.ceil((roleCostCents * 100) / percentage));
}

function roleAllocation(
  cents: number,
  percentage: number,
  estimatedHours: number,
): ProjectBudgetRoleAllocation {
  return {
    percentage,
    amount: fromCents(cents),
    estimatedHours,
    maxHourlyRate: fromCents(Math.floor(cents / estimatedHours)),
  };
}

function normalizeCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error('Project budget allocation requires a 3-letter currency');
  }
  return currency;
}

function toCents(value: number | string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function fromCents(cents: number) {
  return (cents / 100).toFixed(2);
}
