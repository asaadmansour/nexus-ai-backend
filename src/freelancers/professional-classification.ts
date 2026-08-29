export const PROFESSIONAL_ROLES = [
  'backend',
  'frontend',
  'fullstack',
  'mobile',
  'ui_ux',
  'qa',
  'devops',
  'data',
  'ai_ml',
  'architect',
] as const;

export const SENIORITY_LEVELS = ['junior', 'mid', 'senior'] as const;

export type ProfessionalRole = (typeof PROFESSIONAL_ROLES)[number];
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];
export type ClassificationSource = 'assessment' | 'admin' | 'migration';

export function isProfessionalRole(value: string): value is ProfessionalRole {
  return (PROFESSIONAL_ROLES as readonly string[]).includes(value);
}

export function isSeniorityLevel(value: string): value is SeniorityLevel {
  return (SENIORITY_LEVELS as readonly string[]).includes(value);
}

const ROLE_PATTERNS: Array<[ProfessionalRole, RegExp]> = [
  ['architect', /\b(architect|architecture|system design)\b/i],
  ['ui_ux', /\b(ui\s*[/&-]?\s*ux|ux|user experience|figma|product design)\b/i],
  [
    'ai_ml',
    /\b(ai|machine learning|deep learning|llm|artificial intelligence)\b/i,
  ],
  ['data', /\b(data engineer|data science|analytics|etl|warehouse|spark)\b/i],
  ['devops', /\b(devops|sre|site reliability|kubernetes|terraform|ci\/cd)\b/i],
  [
    'qa',
    /\b(qa|quality assurance|test automation|software tester|testing engineer)\b/i,
  ],
  ['mobile', /\b(mobile|android|ios|flutter|react native|swift|kotlin)\b/i],
  ['fullstack', /\b(full[ -]?stack)\b/i],
  ['frontend', /\b(front[ -]?end|react|angular|vue|next\.?js)\b/i],
  [
    'backend',
    /\b(back[ -]?end|nest\.?js|node\.?js|spring|django|laravel|\.net)\b/i,
  ],
];

export function inferProfessionalRole(input: {
  role?: unknown;
  headline?: string | null;
  skills?: string[] | null;
}): ProfessionalRole | null {
  const explicit =
    typeof input.role === 'string' ? input.role.trim().toLowerCase() : '';
  if (isProfessionalRole(explicit)) {
    return explicit;
  }

  const source = [input.headline ?? '', ...(input.skills ?? [])].join(' ');
  return ROLE_PATTERNS.find(([, pattern]) => pattern.test(source))?.[0] ?? null;
}

export function inferAssessmentTargetSeniority(input: {
  seniority?: unknown;
  headline?: string | null;
  yearsExperience?: number | null;
}): SeniorityLevel {
  const explicit =
    typeof input.seniority === 'string'
      ? input.seniority.trim().toLowerCase()
      : '';
  if (isSeniorityLevel(explicit)) {
    return explicit;
  }

  const headline = input.headline ?? '';
  if (/\b(principal|staff|lead|senior|sr\.?)\b/i.test(headline))
    return 'senior';
  if (/\b(mid|intermediate)\b/i.test(headline)) return 'mid';
  if (/\b(junior|jr\.?|entry)\b/i.test(headline)) return 'junior';

  const years = input.yearsExperience ?? 0;
  if (years >= 6) return 'senior';
  if (years >= 3) return 'mid';
  return 'junior';
}

export function seniorityFromAssessmentScore(score: number): SeniorityLevel {
  if (score >= 80) return 'senior';
  if (score >= 60) return 'mid';
  return 'junior';
}

export function formatProfessionalTitle(
  role: ProfessionalRole | null | undefined,
  seniority: SeniorityLevel | null | undefined,
) {
  if (!role) return null;
  const roleLabel: Record<ProfessionalRole, string> = {
    backend: 'Backend',
    frontend: 'Frontend',
    fullstack: 'Full-stack',
    mobile: 'Mobile',
    ui_ux: 'UI/UX',
    qa: 'QA',
    devops: 'DevOps',
    data: 'Data',
    ai_ml: 'AI/ML',
    architect: 'Architect',
  };
  const level = seniority
    ? `${seniority.charAt(0).toUpperCase()}${seniority.slice(1)} `
    : '';
  return `${level}${roleLabel[role]}`;
}
