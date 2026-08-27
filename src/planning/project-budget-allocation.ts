export const PROJECT_BUDGET_ALLOCATION_VERSION = 2;

export type PlanningBudgetRole = 'architect' | 'ui_ux';
export type ProjectBudgetComplexity = 'trivial' | 'standard' | 'complex';
export type CostedProjectRole =
  'principal_reviewer' | PlanningBudgetRole | 'implementation' | 'platform_fee';

export interface ProjectBudgetRoleAllocation {
  percentage: number;
  amount: string;
  estimatedHours: number;
  people: number;
  maxHourlyRate: string;
}

export interface ProjectBudgetRoleEstimate {
  roleKey: Exclude<CostedProjectRole, 'platform_fee'>;
  people: number;
  hoursEach: number;
  hourlyRate: number;
  subtotal?: number;
}

export interface ProjectBudgetAllocation extends Record<string, unknown> {
  version: number;
  strategy: 'automation_first_market_cost';
  totalAmount: string;
  currency: string;
  complexity: ProjectBudgetComplexity;
  platformFee: {
    percentage: number;
    amount: string;
  };
  governance: {
    principalReviewer: ProjectBudgetRoleAllocation;
  };
  planning: Record<PlanningBudgetRole, ProjectBudgetRoleAllocation>;
  implementation: {
    percentage: number;
    amount: string;
    estimatedHours?: number;
    people?: number;
    maxHourlyRate?: string;
  };
  minimumRecommendedAmount: string;
  budgetGap: string;
  generatedAt: string;
}

export interface ProjectFundingBreakdown {
  currency: string;
  totalAmount: string;
  planningAmount: string;
  implementationAmount: string;
  planningIncludes: {
    platformFee: string;
    principalReviewer: string;
    architect: string;
    uiUx: string;
  };
}

type LegacyProjectBudgetAllocation = {
  version: 1;
  strategy: 'planning_25_25_implementation_50';
  totalAmount: string;
  currency: string;
  complexity: ProjectBudgetComplexity;
  planning: Record<PlanningBudgetRole, ProjectBudgetRoleAllocation>;
  implementation: { percentage: number; amount: string };
  generatedAt: string;
};

const ROLE_PERCENTAGES: Record<
  ProjectBudgetComplexity,
  Record<CostedProjectRole, number>
> = {
  trivial: {
    platform_fee: 10,
    principal_reviewer: 8,
    architect: 8,
    ui_ux: 8,
    implementation: 66,
  },
  standard: {
    platform_fee: 10,
    principal_reviewer: 10,
    architect: 15,
    ui_ux: 15,
    implementation: 50,
  },
  complex: {
    platform_fee: 10,
    principal_reviewer: 12,
    architect: 18,
    ui_ux: 16,
    implementation: 44,
  },
};

const ROLE_HOURS: Record<
  ProjectBudgetComplexity,
  Record<'principal_reviewer' | PlanningBudgetRole, number>
> = {
  trivial: { principal_reviewer: 4, architect: 3, ui_ux: 3 },
  standard: { principal_reviewer: 12, architect: 12, ui_ux: 12 },
  complex: { principal_reviewer: 24, architect: 24, ui_ux: 22 },
};

export function createProjectBudgetAllocation(
  totalAmount: number | string,
  currencyValue: string,
  complexity: ProjectBudgetComplexity = 'standard',
  generatedAt = new Date(),
  marketRates: Partial<
    Record<'principal_reviewer' | PlanningBudgetRole | 'implementation', number>
  > = {},
  marketEstimates: ProjectBudgetRoleEstimate[] = [],
): ProjectBudgetAllocation {
  const totalCents = toCents(totalAmount);
  if (totalCents <= 0) {
    throw new Error('Project budget allocation requires a positive total');
  }
  const currency = normalizeCurrency(currencyValue);
  const percentages = ROLE_PERCENTAGES[complexity];
  const hours = ROLE_HOURS[complexity];
  const feeCents = percentCents(totalCents, percentages.platform_fee);
  const normalizedEstimates = normalizeMarketEstimates(marketEstimates);
  const dynamicCents = normalizedEstimates
    ? proportionalRoleCents(totalCents - feeCents, normalizedEstimates)
    : null;
  const reviewerCents =
    dynamicCents?.principal_reviewer ??
    percentCents(totalCents, percentages.principal_reviewer);
  const architectCents =
    dynamicCents?.architect ?? percentCents(totalCents, percentages.architect);
  const uiuxCents =
    dynamicCents?.ui_ux ?? percentCents(totalCents, percentages.ui_ux);
  const implementationCents = dynamicCents
    ? dynamicCents.implementation
    : totalCents - feeCents - reviewerCents - architectCents - uiuxCents;
  const estimateByRole = normalizedEstimates
    ? Object.fromEntries(
        normalizedEstimates.map((estimate) => [estimate.roleKey, estimate]),
      )
    : null;

  const minimumRecommendedCents = normalizedEstimates
    ? Math.ceil(
        (normalizedEstimates.reduce(
          (sum, estimate) => sum + estimate.costCents,
          0,
        ) *
          100) /
          (100 - percentages.platform_fee),
      )
    : Math.max(
        totalCents,
        minimumTotalForRole(
          marketRates.principal_reviewer,
          hours.principal_reviewer,
          percentages.principal_reviewer,
        ),
        minimumTotalForRole(
          marketRates.architect,
          hours.architect,
          percentages.architect,
        ),
        minimumTotalForRole(marketRates.ui_ux, hours.ui_ux, percentages.ui_ux),
      );

  return {
    version: PROJECT_BUDGET_ALLOCATION_VERSION,
    strategy: 'automation_first_market_cost',
    totalAmount: fromCents(totalCents),
    currency,
    complexity,
    platformFee: {
      percentage: percentages.platform_fee,
      amount: fromCents(feeCents),
    },
    governance: {
      principalReviewer: roleAllocation(
        reviewerCents,
        percentageOf(reviewerCents, totalCents),
        estimateByRole?.principal_reviewer?.totalHours ??
          hours.principal_reviewer,
        estimateByRole?.principal_reviewer?.people ?? 1,
      ),
    },
    planning: {
      architect: roleAllocation(
        architectCents,
        percentageOf(architectCents, totalCents),
        estimateByRole?.architect?.totalHours ?? hours.architect,
        estimateByRole?.architect?.people ?? 1,
      ),
      ui_ux: roleAllocation(
        uiuxCents,
        percentageOf(uiuxCents, totalCents),
        estimateByRole?.ui_ux?.totalHours ?? hours.ui_ux,
        estimateByRole?.ui_ux?.people ?? 1,
      ),
    },
    implementation: {
      percentage: percentageOf(implementationCents, totalCents),
      amount: fromCents(implementationCents),
      ...(estimateByRole?.implementation
        ? {
            estimatedHours: estimateByRole.implementation.totalHours,
            people: estimateByRole.implementation.people,
            maxHourlyRate: fromCents(
              Math.floor(
                implementationCents / estimateByRole.implementation.totalHours,
              ),
            ),
          }
        : {}),
    },
    minimumRecommendedAmount: fromCents(minimumRecommendedCents),
    budgetGap: fromCents(Math.max(minimumRecommendedCents - totalCents, 0)),
    generatedAt: generatedAt.toISOString(),
  };
}

export function projectBudgetAllocation(
  value: Record<string, unknown> | null | undefined,
): ProjectBudgetAllocation | LegacyProjectBudgetAllocation | null {
  if (!value) return null;
  if (value.version === 1) {
    const legacy = value as LegacyProjectBudgetAllocation;
    return legacy.strategy === 'planning_25_25_implementation_50' &&
      legacy.planning?.architect &&
      legacy.planning?.ui_ux &&
      legacy.implementation
      ? legacy
      : null;
  }
  if (value.version !== PROJECT_BUDGET_ALLOCATION_VERSION) return null;
  const candidate = value as ProjectBudgetAllocation;
  return candidate.strategy === 'automation_first_market_cost' &&
    candidate.governance?.principalReviewer &&
    candidate.planning?.architect &&
    candidate.planning?.ui_ux &&
    candidate.platformFee &&
    candidate.implementation
    ? candidate
    : null;
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

export function principalReviewerRoleAllocation(
  value: Record<string, unknown> | null | undefined,
) {
  const allocation = projectBudgetAllocation(value);
  return allocation && allocation.version === 2
    ? allocation.governance.principalReviewer
    : null;
}

export function platformFeeAllocation(
  value: Record<string, unknown> | null | undefined,
) {
  const allocation = projectBudgetAllocation(value);
  return allocation && allocation.version === 2 ? allocation.platformFee : null;
}

export function implementationBudgetAmount(
  value: Record<string, unknown> | null | undefined,
) {
  const allocation = projectBudgetAllocation(value);
  return allocation ? Number(allocation.implementation.amount) : null;
}

/**
 * Split customer funding at the point where each cost becomes knowable.
 *
 * Planning is a useful paid deliverable in its own right: the customer receives
 * reviewed architecture, UI/UX, and an executable Scrum plan even if exact
 * implementation staffing later proves impossible. Collecting this amount
 * before that work starts means Nexus never has to finance those freelancers.
 * The implementation pool is collected only after the materialized tasks have
 * accepted assignees.
 */
export function projectFundingBreakdown(
  value: Record<string, unknown> | null | undefined,
): ProjectFundingBreakdown | null {
  const allocation = projectBudgetAllocation(value);
  if (!allocation) return null;

  if (!('platformFee' in allocation)) {
    const architect = toCents(allocation.planning.architect.amount);
    const uiUx = toCents(allocation.planning.ui_ux.amount);
    const implementation = toCents(allocation.implementation.amount);
    const planning = architect + uiUx;
    return {
      currency: normalizeCurrency(allocation.currency),
      totalAmount: fromCents(planning + implementation),
      planningAmount: fromCents(planning),
      implementationAmount: fromCents(implementation),
      planningIncludes: {
        platformFee: '0.00',
        principalReviewer: '0.00',
        architect: fromCents(architect),
        uiUx: fromCents(uiUx),
      },
    };
  }

  const platformFee = toCents(allocation.platformFee.amount);
  const principalReviewer = toCents(
    allocation.governance.principalReviewer.amount,
  );
  const architect = toCents(allocation.planning.architect.amount);
  const uiUx = toCents(allocation.planning.ui_ux.amount);
  const implementation = toCents(allocation.implementation.amount);
  const planning = platformFee + principalReviewer + architect + uiUx;

  return {
    currency: normalizeCurrency(allocation.currency),
    totalAmount: fromCents(planning + implementation),
    planningAmount: fromCents(planning),
    implementationAmount: fromCents(implementation),
    planningIncludes: {
      platformFee: fromCents(platformFee),
      principalReviewer: fromCents(principalReviewer),
      architect: fromCents(architect),
      uiUx: fromCents(uiUx),
    },
  };
}

export function implementationTeamRoleAllocation(
  value: Record<string, unknown> | null | undefined,
) {
  const allocation = projectBudgetAllocation(value);
  if (!allocation) return null;
  const implementation = allocation.implementation;
  const people = Math.max(
    1,
    Math.round('people' in implementation ? (implementation.people ?? 1) : 1),
  );
  const totalAmount = Number(allocation.implementation.amount);
  const totalHours = Math.max(
    people,
    Math.round(
      'estimatedHours' in implementation
        ? (implementation.estimatedHours ?? people * 40)
        : people * 40,
    ),
  );
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) return null;
  const amount = totalAmount / people;
  const estimatedHours = Math.max(1, Math.ceil(totalHours / people));
  return {
    amount: amount.toFixed(2),
    estimatedHours,
    people,
    maxHourlyRate: (amount / estimatedHours).toFixed(2),
  };
}

export function requiredProjectTotalForRate(
  hourlyRate: number | string,
  roleKey: PlanningBudgetRole,
  estimatedHours: number,
  complexity: ProjectBudgetComplexity = 'standard',
) {
  const roleCostCents = toCents(hourlyRate) * estimatedHours;
  const percentage = ROLE_PERCENTAGES[complexity][roleKey];
  return fromCents(Math.ceil((roleCostCents * 100) / percentage));
}

function minimumTotalForRole(
  rate: number | undefined,
  hours: number,
  percentage: number,
) {
  if (!Number.isFinite(rate) || !rate || rate <= 0) return 0;
  return Math.ceil((toCents(rate) * hours * 100) / percentage);
}

function percentCents(totalCents: number, percentage: number) {
  return Math.round((totalCents * percentage) / 100);
}

function roleAllocation(
  cents: number,
  percentage: number,
  estimatedHours: number,
  people = 1,
): ProjectBudgetRoleAllocation {
  return {
    percentage,
    amount: fromCents(cents),
    estimatedHours,
    people,
    maxHourlyRate: fromCents(Math.floor(cents / estimatedHours)),
  };
}

type NormalizedRoleEstimate = ProjectBudgetRoleEstimate & {
  totalHours: number;
  costCents: number;
};

function normalizeMarketEstimates(
  estimates: ProjectBudgetRoleEstimate[],
): NormalizedRoleEstimate[] | null {
  const required: ProjectBudgetRoleEstimate['roleKey'][] = [
    'principal_reviewer',
    'architect',
    'ui_ux',
    'implementation',
  ];
  const byRole = new Map<
    ProjectBudgetRoleEstimate['roleKey'],
    NormalizedRoleEstimate
  >();
  for (const estimate of estimates) {
    if (!required.includes(estimate.roleKey) || byRole.has(estimate.roleKey)) {
      continue;
    }
    const people = Math.round(Number(estimate.people));
    const hoursEach = Math.round(Number(estimate.hoursEach));
    const hourlyRate = Number(estimate.hourlyRate);
    if (
      !Number.isFinite(people) ||
      people <= 0 ||
      !Number.isFinite(hoursEach) ||
      hoursEach <= 0 ||
      !Number.isFinite(hourlyRate) ||
      hourlyRate <= 0
    ) {
      continue;
    }
    const totalHours = people * hoursEach;
    byRole.set(estimate.roleKey, {
      ...estimate,
      people,
      hoursEach,
      hourlyRate,
      totalHours,
      costCents: Math.round(totalHours * hourlyRate * 100),
    });
  }
  return required.every((role) => byRole.has(role))
    ? required.map((role) => byRole.get(role)!)
    : null;
}

function proportionalRoleCents(
  laborPoolCents: number,
  estimates: NormalizedRoleEstimate[],
) {
  const totalCost = estimates.reduce(
    (sum, estimate) => sum + estimate.costCents,
    0,
  );
  const shares = estimates.map((estimate, index) => {
    const raw = (laborPoolCents * estimate.costCents) / totalCost;
    return {
      roleKey: estimate.roleKey,
      cents: Math.floor(raw),
      fraction: raw - Math.floor(raw),
      index,
    };
  });
  let remaining =
    laborPoolCents - shares.reduce((sum, role) => sum + role.cents, 0);
  for (const share of [...shares].sort(
    (left, right) => right.fraction - left.fraction || left.index - right.index,
  )) {
    if (remaining <= 0) break;
    share.cents += 1;
    remaining -= 1;
  }
  return Object.fromEntries(
    shares.map((share) => [share.roleKey, share.cents]),
  ) as Record<ProjectBudgetRoleEstimate['roleKey'], number>;
}

function percentageOf(cents: number, totalCents: number) {
  return Number(((cents * 100) / totalCents).toFixed(2));
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
