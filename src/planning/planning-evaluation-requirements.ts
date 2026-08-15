import { Brief } from 'src/projects/entities/brief.entity';

export type PlanningSubmissionType = 'architecture' | 'ui_ux';

export interface PlanningEvaluationRequirement {
  key: string;
  title: string;
  description: string;
  mandatory: boolean;
  requiresUrl: boolean;
}

const ARCHITECTURE_REQUIREMENTS: PlanningEvaluationRequirement[] = [
  requirement(
    'system_context',
    'System context and scope',
    'Define users, external systems, trust boundaries, and what is inside or outside the solution.',
  ),
  requirement(
    'architecture_diagram',
    'Architecture diagram',
    'Provide an evidence URL and explain the major components and communication paths.',
    true,
  ),
  requirement(
    'technology_stack',
    'Technology stack and decisions',
    'Name the frontend, backend, database, infrastructure, and major libraries with project-specific rationale.',
  ),
  requirement(
    'module_boundaries',
    'Modules and ownership boundaries',
    'Define modules or services, their responsibilities, public interfaces, and data ownership.',
  ),
  requirement(
    'api_contract',
    'API and event contracts',
    'Provide endpoint or event definitions including method, path/topic, authentication, request, response, validation, and errors.',
    true,
  ),
  requirement(
    'data_model',
    'Data model',
    'Provide entities, important fields, relationships, constraints, indexes, and migration considerations.',
    true,
  ),
  requirement(
    'auth_security',
    'Authentication and security',
    'Define identity, authorization roles, sensitive-data handling, validation, abuse controls, and relevant threats.',
  ),
  requirement(
    'integrations',
    'External integrations',
    'Describe third-party APIs, webhooks, queues, retries, idempotency, timeouts, and failure behavior.',
  ),
  requirement(
    'non_functional',
    'Non-functional requirements',
    'Address performance, scalability, reliability, privacy, accessibility impact, and measurable limits.',
  ),
  requirement(
    'deployment_observability',
    'Deployment and observability',
    'Define environments, configuration, CI/CD, logs, metrics, alerts, backups, and rollback expectations.',
  ),
  requirement(
    'implementation_handoff',
    'Implementation and integration handoff',
    'Define repository structure, coding conventions, contract ownership, dependency order, testing strategy, and integration checkpoints.',
  ),
];

const UIUX_REQUIREMENTS: PlanningEvaluationRequirement[] = [
  requirement(
    'figma_source',
    'Figma source',
    'Provide an accessible Figma project URL containing the submitted design source.',
    true,
  ),
  requirement(
    'information_architecture',
    'Information architecture',
    'Define navigation, screen hierarchy, content organization, and primary entry points.',
  ),
  requirement(
    'user_flows',
    'Complete user flows',
    'Document the primary customer, admin, and operational flows including decisions and failure paths.',
  ),
  requirement(
    'wireframes',
    'Wireframes',
    'Provide wireframes for every required screen and important state.',
    true,
  ),
  requirement(
    'high_fidelity_screens',
    'High-fidelity screens',
    'Provide implementation-ready desktop and mobile designs for the agreed scope.',
    true,
  ),
  requirement(
    'clickable_prototype',
    'Clickable prototype',
    'Provide a prototype URL demonstrating the critical end-to-end journeys.',
    true,
  ),
  requirement(
    'screen_states',
    'Screen and component states',
    'Cover loading, empty, error, success, validation, disabled, permission, and destructive-action states.',
  ),
  requirement(
    'responsive_accessibility',
    'Responsive and accessibility rules',
    'Define breakpoints, keyboard behavior, focus order, contrast, labels, reduced motion, and assistive-technology expectations.',
  ),
  requirement(
    'design_system',
    'Design system and components',
    'Define tokens, typography, colors, spacing, components, variants, states, and reuse rules.',
  ),
  requirement(
    'api_data_mapping',
    'Architecture and API mapping',
    'Map screens and interactions to approved APIs, data fields, permissions, validation, and backend error states.',
  ),
  requirement(
    'asset_handoff',
    'Developer handoff',
    'Provide exportable assets, component annotations, content rules, interaction notes, and unresolved questions.',
  ),
];

export function buildPlanningEvaluationRequirements(
  type: PlanningSubmissionType,
  brief: Brief | null,
) {
  const base =
    type === 'architecture' ? ARCHITECTURE_REQUIREMENTS : UIUX_REQUIREMENTS;
  const features = projectFeatures(brief);
  const usedKeys = new Set(base.map((item) => item.key));
  const featureRequirements = features.flatMap((feature) => {
    const key = `feature_${slug(feature)}`;
    if (usedKeys.has(key)) return [];
    usedKeys.add(key);
    return [
      requirement(
        key,
        `${feature} coverage`,
        type === 'architecture'
          ? `Show how the architecture, contracts, data, security, and failure handling support the project feature “${feature}”.`
          : `Show the complete user flow, screens, states, responsive behavior, and API/data mapping for “${feature}”.`,
      ),
    ];
  });

  return [...base, ...featureRequirements];
}

function requirement(
  key: string,
  title: string,
  description: string,
  requiresUrl = false,
): PlanningEvaluationRequirement {
  return { key, title, description, mandatory: true, requiresUrl };
}

function projectFeatures(brief: Brief | null) {
  const raw = [brief?.coreFeatures, brief?.deliverablesText]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(',');
  return Array.from(
    new Set(
      raw
        .split(/[\n,;]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function slug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return normalized || 'project_requirement';
}
