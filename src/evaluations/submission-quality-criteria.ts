export const IMPLEMENTATION_SUBMISSION_TYPES = new Set([
  'repo',
  'pull_request',
  'zip',
]);

export type ImplementationCriterionCategory =
  | 'requirement'
  | 'quality'
  | 'verification'
  | 'contract'
  | 'scope'
  | 'security'
  | 'operations';

export type ImplementationComplexity = 'trivial' | 'standard' | 'complex';

export interface ImplementationEvaluationCriterion {
  key: string;
  criterion: string;
  category: ImplementationCriterionCategory;
  mandatory: boolean;
  allowNotApplicable: boolean;
  rationale: string;
}

export interface ImplementationEvaluationProfile {
  version: 1;
  complexity: ImplementationComplexity;
  requiresAutomatedTests: boolean;
  capabilities: {
    api: boolean;
    data: boolean;
    authenticationOrPrivacy: boolean;
    operationsOrMigration: boolean;
  };
  rationale: string[];
}

export interface ImplementationRubricSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  profile: ImplementationEvaluationProfile;
  criteria: ImplementationEvaluationCriterion[];
}

interface ImplementationRubricTaskInput {
  title?: string | null;
  description?: string | null;
  acceptanceCriteria?: string[];
  deliverables?: string[];
  integrationChecks?: string[];
  contractReferences?: string[];
  ownedPaths?: string[];
}

export interface BuildImplementationRubricInput {
  submissionType: string;
  task: ImplementationRubricTaskInput;
  projectSpec?: Record<string, unknown> | null;
  capturedAt?: string;
}

const API_PATTERN =
  /\b(api|endpoint|webhook|controller|graphql|rest api|http api)\b|\b(get|post|put|patch|delete)\s+\//i;
const DATA_PATTERN =
  /\b(database|data model|migration|schema|entity|query|persist\w*|storage|sql)\b/i;
const AUTH_PATTERN =
  /\b(auth|authenticat\w*|authoriz\w*|permission|login|session|token|password|private|privacy|personal data|pii|payment)\b/i;
const OPERATIONS_PATTERN =
  /\b(docker|container|kubernetes|infrastructure|ci\/cd|pipeline|logging|metric|monitor|alert|rollback|environment|configuration|migration)\b/i;
const BEHAVIOR_PATTERN =
  /\b(payment|workflow|algorithm|calculation|validation|retry|idempot\w*|regression|business logic|queue|webhook)\b|\bstate (management|machine|transition)\b/i;
const TEST_PATTERN =
  /\b(automated tests?|unit tests?|integration tests?|contract tests?|end[- ]to[- ]end tests?|e2e tests?|test suite|test coverage|regression tests?|jest|vitest|pytest|cypress|playwright)\b|\b(add|write|include|provide) (automated )?tests?\b/i;

function strings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function sectionApplicable(
  projectSpec: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  const value = projectSpec?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).applicable !== false;
}

function addRequirementRows(
  target: ImplementationEvaluationCriterion[],
  keyPrefix: string,
  values: string[],
  rationale: string,
) {
  values.forEach((criterion, index) => {
    target.push({
      key: `${keyPrefix}_${index + 1}`,
      criterion,
      category: 'requirement',
      mandatory: true,
      allowNotApplicable: false,
      rationale,
    });
  });
}

/**
 * Builds a task-aware implementation rubric. Universal correctness, clarity,
 * verification, scope and secret-safety gates remain mandatory; specialized
 * enterprise concerns are included only when the task or approved contract
 * makes them relevant.
 */
export function buildImplementationEvaluationRubric(
  input: BuildImplementationRubricInput,
): ImplementationRubricSnapshot {
  if (!IMPLEMENTATION_SUBMISSION_TYPES.has(input.submissionType)) {
    return {
      schemaVersion: 1,
      capturedAt: input.capturedAt ?? new Date().toISOString(),
      profile: {
        version: 1,
        complexity: 'trivial',
        requiresAutomatedTests: false,
        capabilities: {
          api: false,
          data: false,
          authenticationOrPrivacy: false,
          operationsOrMigration: false,
        },
        rationale: ['This is not an implementation artifact.'],
      },
      criteria: [],
    };
  }

  const acceptanceCriteria = strings(input.task.acceptanceCriteria);
  const deliverables = strings(input.task.deliverables);
  const integrationChecks = strings(input.task.integrationChecks);
  const contractReferences = strings(input.task.contractReferences);
  const ownedPaths = strings(input.task.ownedPaths);
  const taskText = [
    input.task.title,
    input.task.description,
    ...acceptanceCriteria,
    ...deliverables,
    ...integrationChecks,
    ...contractReferences,
  ]
    .filter(Boolean)
    .join('\n');

  const api = API_PATTERN.test(taskText);
  const data = DATA_PATTERN.test(taskText);
  const authenticationOrPrivacy = AUTH_PATTERN.test(taskText);
  const operationsOrMigration = OPERATIONS_PATTERN.test(taskText);
  const requiresAutomatedTests =
    TEST_PATTERN.test(
      [...acceptanceCriteria, ...integrationChecks, ...deliverables].join('\n'),
    ) ||
    api ||
    data ||
    authenticationOrPrivacy ||
    BEHAVIOR_PATTERN.test(taskText);
  const capabilityCount = [
    api,
    data,
    authenticationOrPrivacy,
    operationsOrMigration,
  ].filter(Boolean).length;
  const complexity: ImplementationComplexity =
    capabilityCount >= 3 ||
    acceptanceCriteria.length + integrationChecks.length > 8
      ? 'complex'
      : capabilityCount === 0 && acceptanceCriteria.length <= 4
        ? 'trivial'
        : 'standard';

  const profile: ImplementationEvaluationProfile = {
    version: 1,
    complexity,
    requiresAutomatedTests,
    capabilities: {
      api,
      data,
      authenticationOrPrivacy,
      operationsOrMigration,
    },
    rationale: [
      `Classified as ${complexity} from the assigned behavior and integration surface.`,
      requiresAutomatedTests
        ? 'Behavioral risk or an explicit test requirement makes automated tests mandatory.'
        : 'No behavioral-risk or explicit test signal was found; build, lint, or focused smoke evidence is proportionate.',
    ],
  };
  const criteria: ImplementationEvaluationCriterion[] = [];

  addRequirementRows(
    criteria,
    'acceptance',
    acceptanceCriteria,
    'Explicit task acceptance criterion.',
  );
  addRequirementRows(
    criteria,
    'deliverable',
    deliverables,
    'Explicit task deliverable.',
  );
  addRequirementRows(
    criteria,
    'integration',
    integrationChecks,
    'Explicit task integration check.',
  );

  criteria.push(
    {
      key: 'quality_functional_correctness',
      criterion:
        'The implementation is functionally correct for the assigned behavior, handles relevant failure paths, and adds no unrelated scope.',
      category: 'quality',
      mandatory: true,
      allowNotApplicable: false,
      rationale:
        'Correctness and scope discipline apply to every implementation.',
    },
    {
      key: 'quality_code_clarity',
      criterion:
        'The code is clear, cohesive, consistently named, free of unnecessary duplication or debug artifacts, and uses only the structure this task needs.',
      category: 'quality',
      mandatory: true,
      allowNotApplicable: false,
      rationale:
        'Clean code is universal, while architecture patterns and SOLID abstractions must remain proportionate.',
    },
    {
      key: 'security_baseline',
      criterion:
        'The change exposes no secrets, unsafe dependency changes, or obviously unsafe handling of untrusted data.',
      category: 'security',
      mandatory: true,
      allowNotApplicable: false,
      rationale:
        'Basic secret and supply-chain safety applies to every code change.',
    },
    {
      key: requiresAutomatedTests
        ? 'verification_automated_tests'
        : 'verification_proportionate',
      criterion: requiresAutomatedTests
        ? 'Automated tests cover the changed behavior and relevant failure or regression paths, and the supplied test evidence passes.'
        : 'Proportionate verification passes for this change, using build, lint, focused smoke checks, or automated tests where useful.',
      category: 'verification',
      mandatory: true,
      allowNotApplicable: false,
      rationale: requiresAutomatedTests
        ? 'The assigned behavior has enough risk to require executable regression protection.'
        : 'A small change still needs objective verification, but a new test suite is not automatically required.',
    },
  );

  const contractCapability =
    contractReferences.length > 0 ||
    (sectionApplicable(input.projectSpec, 'apiContract') &&
      API_PATTERN.test(taskText)) ||
    (sectionApplicable(input.projectSpec, 'dataModel') &&
      DATA_PATTERN.test(taskText));
  if (contractCapability) {
    criteria.push({
      key: 'contract_compatibility',
      criterion:
        'Approved architecture, API, and data contracts touched by this task remain compatible with the implementation.',
      category: 'contract',
      mandatory: true,
      allowNotApplicable: true,
      rationale:
        'Contract compatibility matters only for approved contracts actually touched by the change.',
    });
  }
  contractReferences.forEach((reference, index) => {
    criteria.push({
      key: `contract_reference_${index + 1}`,
      criterion: `Implementation conforms to approved contract reference: ${reference}`,
      category: 'contract',
      mandatory: true,
      allowNotApplicable: false,
      rationale: 'The Scrum task explicitly references this approved contract.',
    });
  });

  if (authenticationOrPrivacy) {
    criteria.push({
      key: 'security_auth_privacy',
      criterion:
        'Authentication, authorization, input validation, privacy, and sensitive-data handling touched by this task are correct and fail safely.',
      category: 'security',
      mandatory: true,
      allowNotApplicable: true,
      rationale:
        'The task contains an authentication, authorization, payment, or privacy signal.',
    });
  }
  if (operationsOrMigration) {
    criteria.push({
      key: 'operations_readiness',
      criterion:
        'Operational changes include the error handling, logs, configuration, documentation, rollback, or migration notes needed for the affected behavior.',
      category: 'operations',
      mandatory: true,
      allowNotApplicable: true,
      rationale:
        'The task changes deployment, runtime operations, or migrations.',
    });
  }
  if (ownedPaths.length) {
    criteria.push({
      key: 'scope_owned_paths',
      criterion:
        'Changes respect the assigned owned paths unless a documented integration exception is necessary: ' +
        ownedPaths.join(', '),
      category: 'scope',
      mandatory: true,
      allowNotApplicable: false,
      rationale: 'Owned paths let parallel freelancers integrate safely.',
    });
  }

  const uniqueCriteria = criteria.filter(
    (item, index) =>
      criteria.findIndex(
        (candidate) => candidate.criterion === item.criterion,
      ) === index,
  );
  return {
    schemaVersion: 1,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    profile,
    criteria: uniqueCriteria,
  };
}

/** @deprecated Use buildImplementationEvaluationRubric for task-aware criteria. */
export const IMPLEMENTATION_QUALITY_CRITERIA = [
  'The implementation is functionally correct for the assigned behavior, handles relevant failure paths, and adds no unrelated scope.',
  'The code is clear, cohesive, consistently named, free of unnecessary duplication or debug artifacts, and uses only the structure this task needs.',
  'The change exposes no secrets, unsafe dependency changes, or obviously unsafe handling of untrusted data.',
  'Proportionate verification passes for this change, using build, lint, focused smoke checks, or automated tests where useful.',
] as const;
