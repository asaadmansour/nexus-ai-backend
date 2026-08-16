import type { Brief } from 'src/projects/entities/brief.entity';

export type PlanningSubmissionType = 'architecture' | 'ui_ux';
export type PlanningComplexity = 'trivial' | 'standard' | 'complex';
export type PlanningRequirementApplicability = 'required' | 'optional';

export interface PlanningProjectContext {
  title?: unknown;
  description?: unknown;
  budgetMin?: unknown;
  budgetMax?: unknown;
  currency?: unknown;
}

export interface PlanningRequirementProfile extends Record<string, unknown> {
  complexity: PlanningComplexity;
  rationale: string;
  featureCount: number;
  features: string[];
  capabilities: {
    hasBackend: boolean;
    hasApi: boolean;
    hasData: boolean;
    hasAuth: boolean;
    hasIntegrations: boolean;
    hasMultipleScreens: boolean;
    hasMultiStepFlows: boolean;
  };
}

export interface PlanningEvaluationRequirement {
  key: string;
  title: string;
  description: string;
  mandatory: boolean;
  requiresUrl: boolean;
  applicability: PlanningRequirementApplicability;
  allowNotApplicable: boolean;
  rationale: string;
}

export interface PlanningRequirementEvidence {
  summary?: unknown;
  urls?: unknown;
  disposition?: unknown;
  notApplicableReason?: unknown;
}

interface RequirementOptions {
  mandatory?: boolean;
  requiresUrl?: boolean;
  allowNotApplicable?: boolean;
  rationale: string;
}

const QUESTION_PREFIX =
  /^(?:like\s+what|what|which|why|how|when|where|who|can\s+you|could\s+you|for\s+example)\b/i;
const NON_FEATURE_VALUE =
  /^(?:n\/?a|none|nothing|idk|i\s+don'?t\s+know|not\s+sure|no\s+preference|live\s+link|source\s+code|documentation|docs?|handover|deployment\s+help|setup\s+help)$/i;

export function buildPlanningEvaluationRequirements(
  type: PlanningSubmissionType,
  brief: Brief | null,
  project: PlanningProjectContext | null = null,
) {
  const profile = assessPlanningRequirementProfile(project, brief);
  const requirements =
    type === 'architecture'
      ? architectureRequirements(profile)
      : uiuxRequirements(profile);

  return [...requirements, ...featureRequirements(type, profile)];
}

export function assessPlanningRequirementProfile(
  project: PlanningProjectContext | null,
  brief: Brief | null,
): PlanningRequirementProfile {
  const features = projectFeatures(brief);
  const platforms = splitValues(brief?.platforms);
  const text = searchableText(project, brief, features);
  const hasAuth = hasAny(text, [
    'auth',
    'login',
    'sign in',
    'signup',
    'account',
    'permission',
    'user role',
  ]);
  const hasData = hasAny(text, [
    'database',
    'persist',
    'storage',
    'crud',
    'orders',
    'bookings',
    'inventory',
    'profiles',
    'records',
    'content management',
  ]);
  const hasApi = hasAny(text, [
    'api',
    'backend',
    'server-side',
    'webhook',
    'real-time',
    'realtime',
    'payment',
    'upload',
    'form submission',
    'contact form',
  ]);
  const hasIntegrations = hasAny(text, [
    'integration',
    'third-party',
    'webhook',
    'payment',
    'stripe',
    'map',
    'email provider',
    'sms',
    'social login',
  ]);
  const hasMultipleScreens =
    features.length >= 3 ||
    hasAny(text, [
      'dashboard',
      'admin',
      'catalog',
      'checkout',
      'profile',
      'mobile app',
      'multi-page',
    ]);
  const hasMultiStepFlows =
    features.length >= 3 ||
    hasAny(text, [
      'workflow',
      'checkout',
      'onboarding',
      'booking',
      'approval',
      'order tracking',
      'multi-step',
    ]);
  const hasBackend = hasApi || hasData || hasAuth || hasIntegrations;
  const explicitSmallScope = hasAny(text, [
    'hello world',
    'single static page',
    'one static page',
    'display one string',
    'display text only',
    'simple static page',
    'coming soon page',
  ]);

  let complexityScore = 0;
  if (features.length >= 3) complexityScore += 1;
  if (features.length >= 7) complexityScore += 2;
  if (platforms.length >= 2) complexityScore += 1;
  if (hasBackend) complexityScore += 2;
  if (hasAuth) complexityScore += 1;
  if (hasIntegrations) complexityScore += 1;
  if (hasMultipleScreens) complexityScore += 1;
  if (hasMultiStepFlows) complexityScore += 1;
  if (hasAny(text, ['multi-tenant', 'marketplace', 'microservice'])) {
    complexityScore += 2;
  }

  const hasEnoughScopeToClassify = Boolean(
    normalizeText(project?.title) ||
    normalizeText(project?.description) ||
    normalizeText(brief?.mainGoal) ||
    features.length,
  );
  const complexity: PlanningComplexity =
    explicitSmallScope && !hasBackend && features.length <= 2
      ? 'trivial'
      : hasEnoughScopeToClassify &&
          !hasBackend &&
          features.length <= 2 &&
          platforms.length <= 1
        ? 'trivial'
        : complexityScore >= 6
          ? 'complex'
          : 'standard';

  const rationale =
    complexity === 'trivial'
      ? 'Small static or single-screen scope with no detected backend, persistent data, authentication, or external integration.'
      : complexity === 'complex'
        ? 'Multiple feature, platform, workflow, data, identity, or integration concerns require detailed implementation contracts.'
        : 'A normal product scope needs concrete implementation guidance without an enterprise-sized planning package.';

  return {
    complexity,
    rationale,
    featureCount: features.length,
    features,
    capabilities: {
      hasBackend,
      hasApi,
      hasData,
      hasAuth,
      hasIntegrations,
      hasMultipleScreens,
      hasMultiStepFlows,
    },
  };
}

export function validatePlanningRequirementEvidence(
  requirements: PlanningEvaluationRequirement[],
  content: Record<string, unknown> | null | undefined,
) {
  const evidenceMap = asRecord(asRecord(content).requirementEvidence);
  const errors: string[] = [];

  for (const item of requirements) {
    const evidence = asRecord(
      evidenceMap[item.key],
    ) as PlanningRequirementEvidence;
    const disposition =
      evidence.disposition === 'not_applicable' ? 'not_applicable' : 'covered';
    const summary = normalizeText(evidence.summary);
    const reason = normalizeText(evidence.notApplicableReason);
    const urls = Array.isArray(evidence.urls)
      ? evidence.urls
          .map((value) => normalizeText(value))
          .filter((value): value is string => Boolean(value))
      : [];

    if (disposition === 'not_applicable') {
      if (!item.allowNotApplicable) {
        errors.push(`${item.title} cannot be marked not applicable`);
      } else if (!reason || reason.length < 20) {
        errors.push(
          `${item.title} needs a not-applicable reason of at least 20 characters`,
        );
      }
      continue;
    }

    if (!item.mandatory && !summary && urls.length === 0) continue;
    if (!summary) errors.push(`${item.title} needs project-specific evidence`);
    if (item.requiresUrl && !urls.some(isSafeEvidenceUrl)) {
      errors.push(`${item.title} needs an accessible HTTPS evidence URL`);
    }
  }

  return errors;
}

function architectureRequirements(profile: PlanningRequirementProfile) {
  if (profile.complexity === 'trivial') {
    return [
      requirement(
        'system_context',
        'Scope and boundaries',
        'State the user-visible result, what is included, and what is intentionally outside this small solution.',
        { rationale: 'Prevents accidental scope expansion.' },
      ),
      requirement(
        'technology_stack',
        'Minimal solution and hosting choice',
        'Name the smallest suitable implementation and hosting approach, with a brief cost and simplicity rationale.',
        {
          rationale:
            'The chosen solution should match the small scope and budget.',
        },
      ),
      requirement(
        'non_functional',
        'Essential quality checks',
        'Define only relevant measurable checks such as exact displayed content, responsive layout, accessibility basics, load success, and browser support.',
        { rationale: 'Small work still needs objective acceptance checks.' },
      ),
      requirement(
        'deployment_observability',
        'Deployment and implementation handoff',
        'Give the repository/file structure, deployment steps, live-link expectation, and a simple verification or rollback instruction.',
        { rationale: 'Implementation and delivery should be reproducible.' },
      ),
    ];
  }

  const requirements = [
    requirement(
      'system_context',
      'System context and scope',
      'Define users, external systems, trust boundaries, and what is inside or outside the solution.',
      { rationale: 'Establishes the implementation boundary.' },
    ),
    requirement(
      'architecture_diagram',
      'Architecture diagram',
      'Provide an inspectable diagram and explain the major components and communication paths.',
      {
        requiresUrl: true,
        rationale: 'Makes component and dependency boundaries reviewable.',
      },
    ),
    requirement(
      'technology_stack',
      'Technology stack and decisions',
      'Name only the frontend, backend, data, infrastructure, and libraries that apply, with project-specific rationale.',
      { rationale: 'Records decisions without forcing unused technology.' },
    ),
    requirement(
      'module_boundaries',
      'Modules and ownership boundaries',
      'Define applicable modules or services, responsibilities, public interfaces, and data ownership. Prefer a monolith when separate services add no value.',
      {
        allowNotApplicable: true,
        rationale:
          'Supports parallel implementation without prescribing microservices.',
      },
    ),
  ];

  if (profile.capabilities.hasBackend) {
    requirements.push(
      requirement(
        'api_contract',
        'API and event contracts',
        'Define applicable endpoints or events with method/path, authentication, request, response, validation, and errors. Mark this N/A with justification if the approved solution has no API or events.',
        {
          requiresUrl: profile.complexity === 'complex',
          allowNotApplicable: true,
          rationale:
            'Detected backend or server-side behavior requires a stable contract.',
        },
      ),
    );
  }
  if (profile.capabilities.hasData) {
    requirements.push(
      requirement(
        'data_model',
        'Data model',
        'Define persistent entities, important fields, relationships, constraints, indexes, and migrations. Mark this N/A with justification if no persistent data is used.',
        {
          requiresUrl: profile.complexity === 'complex',
          allowNotApplicable: true,
          rationale:
            'Detected persistent data needs an implementation contract.',
        },
      ),
    );
  }
  if (profile.capabilities.hasAuth) {
    requirements.push(
      requirement(
        'auth_security',
        'Authentication and security',
        'Define identity, authorization roles, sensitive-data handling, validation, abuse controls, and relevant threats.',
        {
          allowNotApplicable: true,
          rationale:
            'Detected identity or permission behavior needs explicit controls.',
        },
      ),
    );
  }
  if (profile.capabilities.hasIntegrations) {
    requirements.push(
      requirement(
        'integrations',
        'External integrations',
        'Describe only applicable third-party APIs or webhooks, including retries, idempotency, timeouts, and failure behavior.',
        {
          allowNotApplicable: true,
          rationale: 'Detected external dependencies need failure contracts.',
        },
      ),
    );
  }

  requirements.push(
    requirement(
      'non_functional',
      'Proportionate non-functional requirements',
      'Set measurable limits only for relevant performance, reliability, privacy, accessibility, and scale concerns.',
      {
        rationale:
          'Quality targets should be measurable and scope-appropriate.',
      },
    ),
    requirement(
      'deployment_observability',
      'Deployment and operations',
      profile.complexity === 'complex'
        ? 'Define environments, configuration, CI/CD, logs, metrics, alerts, backups, and rollback expectations that actually apply.'
        : 'Define deployment, configuration, essential logging or health checks, and rollback. Do not add enterprise monitoring where it has no operational value.',
      { rationale: 'Makes delivery and recovery reproducible.' },
    ),
    requirement(
      'implementation_handoff',
      'Implementation and integration handoff',
      'Define repository structure, coding conventions, applicable contract ownership, dependency order, testing strategy, and integration checkpoints.',
      {
        rationale:
          'Lets the Scrum Master split work without inventing decisions.',
      },
    ),
  );
  return requirements;
}

function uiuxRequirements(profile: PlanningRequirementProfile) {
  if (profile.complexity === 'trivial') {
    return [
      requirement(
        'screen_designs',
        'Single-screen visual specification',
        'Provide one inspectable mockup, annotated sketch, or equivalent specification showing content, hierarchy, typography, spacing, and colors. Figma is optional.',
        {
          requiresUrl: true,
          rationale:
            'One implementation-ready screen is enough for this scope.',
        },
      ),
      requirement(
        'responsive_accessibility',
        'Responsive and accessibility behavior',
        'Define the small set of mobile/desktop layout rules plus readable contrast, semantic heading, keyboard, and focus expectations that apply.',
        { rationale: 'The simple screen must still work for real users.' },
      ),
      requirement(
        'asset_handoff',
        'Frontend handoff',
        'Provide exact text/content, reusable style values, any assets, and a short acceptance checklist. Do not create unused flows, states, or components.',
        {
          rationale:
            'Gives the implementer everything needed without design ceremony.',
        },
      ),
    ];
  }

  const requirements = [
    requirement(
      'design_source',
      'Design source and screen inventory',
      'Provide an accessible Figma, Penpot, equivalent design URL, or immutable design artifact, and list the screens included.',
      {
        requiresUrl: true,
        rationale: 'The visual source and scope must be inspectable.',
      },
    ),
  ];
  if (profile.capabilities.hasMultipleScreens) {
    requirements.push(
      requirement(
        'information_architecture',
        'Information architecture',
        'Define applicable navigation, screen hierarchy, content organization, and entry points.',
        { rationale: 'Detected multi-screen scope needs a navigation model.' },
      ),
    );
  }
  if (profile.capabilities.hasMultiStepFlows) {
    requirements.push(
      requirement(
        'user_flows',
        'Primary user flows',
        'Document only the in-scope user and operational journeys, including decisions and meaningful failure paths.',
        {
          rationale:
            'Detected workflows need an unambiguous interaction sequence.',
        },
      ),
    );
  }
  requirements.push(
    requirement(
      'screen_designs',
      'Implementation-ready screen designs',
      'Provide wireframes or high-fidelity designs for every in-scope screen and important responsive variant; do not require both when one artifact is sufficient.',
      {
        requiresUrl: true,
        rationale: 'Avoids duplicative wireframe and high-fidelity gates.',
      },
    ),
  );
  if (profile.capabilities.hasMultiStepFlows) {
    requirements.push(
      requirement(
        'clickable_prototype',
        'Clickable prototype',
        'Demonstrate the critical multi-step journey, or justify why annotated flows are sufficient.',
        {
          mandatory: profile.complexity === 'complex',
          requiresUrl: profile.complexity === 'complex',
          allowNotApplicable: true,
          rationale:
            'A prototype is valuable for complex flows but not universal.',
        },
      ),
    );
  }
  if (
    profile.capabilities.hasBackend ||
    profile.capabilities.hasMultiStepFlows
  ) {
    requirements.push(
      requirement(
        'screen_states',
        'Relevant screen and component states',
        'Cover only states that can occur, such as loading, empty, error, success, validation, permission, disabled, or destructive actions.',
        {
          allowNotApplicable: true,
          rationale: 'Detected interactions need explicit state behavior.',
        },
      ),
    );
  }
  requirements.push(
    requirement(
      'responsive_accessibility',
      'Responsive and accessibility rules',
      'Define relevant breakpoints, keyboard behavior, focus order, contrast, labels, reduced motion, and assistive-technology expectations.',
      {
        rationale:
          'Ensures the approved design is usable across target devices.',
      },
    ),
    requirement(
      'design_system',
      'Proportionate design rules',
      profile.complexity === 'complex'
        ? 'Define tokens, typography, colors, spacing, components, variants, states, and reuse rules.'
        : 'Define only the reusable typography, colors, spacing, and components needed by the approved screens.',
      {
        rationale:
          'Keeps implementation consistent without forcing a large design system.',
      },
    ),
  );
  if (profile.capabilities.hasBackend) {
    requirements.push(
      requirement(
        'api_data_mapping',
        'Architecture and API mapping',
        'Map applicable screens and interactions to approved APIs, data fields, permissions, validation, and backend error states.',
        {
          allowNotApplicable: true,
          rationale:
            'Detected backend behavior needs screen-to-contract mapping.',
        },
      ),
    );
  }
  requirements.push(
    requirement(
      'asset_handoff',
      'Developer handoff',
      'Provide applicable assets, component annotations, content rules, interaction notes, and unresolved questions.',
      { rationale: 'Makes the design implementable without guesswork.' },
    ),
  );
  return requirements;
}

function featureRequirements(
  type: PlanningSubmissionType,
  profile: PlanningRequirementProfile,
) {
  if (!profile.features.length) return [];
  const visibleFeatures = profile.features.slice(
    0,
    profile.complexity === 'complex' ? 10 : 6,
  );
  return [
    requirement(
      'project_feature_coverage',
      'Confirmed feature coverage',
      type === 'architecture'
        ? `Show how the chosen solution supports only these confirmed product features: ${visibleFeatures.join('; ')}.`
        : `Show the screens or visual behavior needed for only these confirmed product features: ${visibleFeatures.join('; ')}.`,
      {
        rationale:
          'Groups confirmed features into one bounded criterion instead of turning every brief fragment into a new form section.',
      },
    ),
  ];
}

function requirement(
  key: string,
  title: string,
  description: string,
  options: RequirementOptions,
): PlanningEvaluationRequirement {
  const mandatory = options.mandatory ?? true;
  return {
    key,
    title,
    description,
    mandatory,
    requiresUrl: options.requiresUrl ?? false,
    applicability: mandatory ? 'required' : 'optional',
    allowNotApplicable: options.allowNotApplicable ?? false,
    rationale: options.rationale,
  };
}

function projectFeatures(brief: Brief | null) {
  return Array.from(
    new Map(
      splitValues(brief?.coreFeatures)
        .filter(isMeaningfulFeature)
        .map((feature) => [slug(feature), feature] as const),
    ).values(),
  ).slice(0, 12);
}

function splitValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitValues(item));
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,;]+/)
    .map((item) => item.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean);
}

function isMeaningfulFeature(value: string) {
  const normalized = value.trim();
  if (normalized.length < 3 || normalized.length > 180) return false;
  if (normalized.includes('?') || QUESTION_PREFIX.test(normalized))
    return false;
  if (NON_FEATURE_VALUE.test(normalized)) return false;
  return /[a-z0-9]/i.test(normalized);
}

function searchableText(
  project: PlanningProjectContext | null,
  brief: Brief | null,
  features: string[],
) {
  return [
    project?.title,
    project?.description,
    brief?.summary,
    brief?.briefText,
    brief?.projectType,
    brief?.domain,
    brief?.mainGoal,
    brief?.targetUsers,
    features,
    brief?.platforms,
    brief?.technical,
    brief?.nonFunctional,
  ]
    .map((value) =>
      typeof value === 'string' ? value : JSON.stringify(value ?? ''),
    )
    .join(' ')
    .toLowerCase();
}

function hasAny(text: string, markers: string[]) {
  return markers.some((marker) => text.includes(marker));
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isSafeEvidenceUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function slug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return normalized || 'project_requirement';
}
