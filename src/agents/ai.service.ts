import { createHash } from 'crypto';
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BriefDto } from './dto/BriefDto';
import { ExtractCvDto } from './dto/ExtractCvDto';
import { GenerateAssessmentDto } from './dto/GenerateAssessmentDto';
import { GenerateEmbeddingDto } from './dto/GenerateEmbeddingDto';
import { GradeAssessmentDto } from './dto/GradeAssessmentDto';
import {
  MatchCandidateInputDto,
  MatchFreelancersDto,
} from './dto/MatchFreelancersDto';
import { GenerateProjectPlanDto } from './dto/GenerateProjectPlanDto';

type ValidateBriefResult = {
  projectId: string | null;
  briefId: string | null;
  isComplete: boolean;
  completionPercentage: number;
  missingFields: string[];
  suggestedReply: string;
  assistantReply?: string | null;
  extractedFields?: Record<string, unknown>;
  nextQuestionField?: string | null;
  fastPathUsed?: boolean;
  fastPathReason?: string | null;
  extractionSource?: string;
  source: 'fastapi' | 'local_mock';
};

type FastApiValidateBriefResponse = {
  isComplete?: boolean;
  completionPercentage?: number;
  nextQuestion?: string;
  assistantReply?: string | null;
  nextQuestionField?: string | null;
  extractedFields?: Record<string, unknown>;
  missingFields?: string[];
  fastPathUsed?: boolean;
  fastPathReason?: string | null;
  extractionSource?: string;
};

type FastApiGenerateAssessmentResponse = {
  durationSeconds?: number;
  questions?: unknown[];
};

type FastApiGradeAssessmentResponse = {
  assessmentId?: string;
  score?: number;
  maxScore?: number;
  recommendation?: string;
  feedback?: string;
  profileSummary?: string;
  graderConfidence?: number;
  questionResults?: unknown[];
};

type FastApiGenerateEmbeddingResponse = {
  embedding?: number[];
  model?: string;
  dimensions?: number;
};

export type MatchFreelancersResultCandidate = {
  freelancerProfileId: string;
  rank: number;
  score: number;
  scoreBreakdown: Record<string, number>;
  rationale: string;
  evidence: Record<string, unknown>;
};

export type MatchFreelancersResult = {
  targetRoleKey: string;
  summary: string;
  candidates: MatchFreelancersResultCandidate[];
  source: 'fastapi' | 'local_mock';
};

export type ProjectPlanMilestone = {
  key: string;
  title: string;
  description?: string;
  orderIndex: number;
  budgetAmount?: number | null;
  currency?: string | null;
  acceptanceCriteria?: string[];
};

export type ProjectPlanTask = {
  key: string;
  milestoneKey: string;
  title: string;
  description?: string;
  priority?: string;
  roleKey?: string;
  requiredSkills?: string[];
  estimatedHours?: number | null;
  orderIndex: number;
  acceptanceCriteria?: string[];
  dependsOn?: string[];
};

export type ProjectPlanResult = {
  summary: string;
  assumptions: string[];
  timeline: Record<string, unknown>;
  milestones: ProjectPlanMilestone[];
  tasks: ProjectPlanTask[];
  teamPlan: Record<string, unknown>;
  riskRegister: Record<string, unknown>[];
  source: 'fastapi' | 'local_mock';
};

const REQUIREMENT_FIELD_NAMES = [
  'projectType',
  'businessDomain',
  'mainGoal',
  'targetUsers',
  'coreFeatures',
  'platforms',
  'budget',
  'deadline',
  'deliverables',
  'constraintsPreferences',
  'clientBackground',
  'suggestedTeamSize',
  'experienceLevel',
  'experienceMinYears',
];

const FIELD_LABEL_MARKERS = [
  ...REQUIREMENT_FIELD_NAMES,
  'project type',
  'business domain',
  'main goal',
  'target users',
  'core features',
  'constraints preferences',
  'client background',
  'suggested team size',
  'experience level',
  'experience min years',
  'project_type',
  'business_domain',
  'main_goal',
  'target_users',
  'core_features',
  'constraints_preferences',
  'client_background',
  'suggested_team_size',
  'experience_level',
  'experience_min_years',
].map((label) => `${label.toLowerCase()}:`);

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly configService: ConfigService) {}

  async extractCv(dto: ExtractCvDto) {
    if (this.isMockMode()) {
      return this.getMockExtractCvResult(dto);
    }

    return this.postToFastApi<Record<string, unknown>>(
      '/agents/extract-cv',
      {
        cvUrl: dto.cvUrl,
      },
      'extract-cv',
    );
  }

  async generateAssessment(dto: GenerateAssessmentDto) {
    if (this.isMockMode()) {
      return this.getMockGenerateAssessmentResult(dto);
    }

    return this.postToFastApi<FastApiGenerateAssessmentResponse>(
      '/agents/generate-assessment',
      {
        cvUrl: dto.cvUrl,
        skills: dto.skills,
        yearsExperience: dto.yearsExperience,
        headline: dto.headline,
        questionCount: dto.questionCount,
        durationSeconds: dto.durationSeconds,
      },
      'generate-assessment',
    );
  }

  async gradeAssessment(dto: GradeAssessmentDto) {
    if (this.isMockMode()) {
      return this.getMockGradeAssessmentResult(dto);
    }

    return this.postToFastApi<FastApiGradeAssessmentResponse>(
      '/agents/grade-assessment',
      {
        assessmentId: dto.assessmentId,
        questions: dto.questions,
        answers: dto.answers,
      },
      'grade-assessment',
    );
  }

  async generateEmbedding(dto: GenerateEmbeddingDto) {
    if (this.isMockMode()) {
      return this.getMockGenerateEmbeddingResult(dto);
    }

    return this.postToFastApi<FastApiGenerateEmbeddingResponse>(
      '/agents/generate-embedding',
      {
        text: dto.text,
        dimensions: dto.dimensions,
        model: dto.model,
      },
      'generate-embedding',
    );
  }

  async matchFreelancers(
    dto: MatchFreelancersDto,
  ): Promise<MatchFreelancersResult> {
    if (this.isMockMode()) {
      return this.getMockMatchFreelancersResult(dto);
    }

    const result = await this.postToFastApi<{
      summary?: string;
      candidates?: MatchFreelancersResultCandidate[];
    }>(
      '/agents/match-freelancers',
      {
        matchingRunId: dto.matchingRunId,
        targetRoleKey: dto.targetRoleKey,
        limit: dto.limit,
        project: dto.project,
        brief: dto.brief,
        candidates: dto.candidates,
      },
      'match-freelancers',
    );

    return {
      targetRoleKey: dto.targetRoleKey,
      summary: result.summary ?? `Ranked candidates for ${dto.targetRoleKey}.`,
      candidates: result.candidates ?? [],
      source: 'fastapi',
    };
  }

  private getMockMatchFreelancersResult(
    dto: MatchFreelancersDto,
  ): MatchFreelancersResult {
    const requiredSkills = this.getRoleRequiredSkills(dto);
    const budgetMax = this.toNumber(dto.project?.budgetMax);
    const limit = dto.limit ?? 10;

    const scored = dto.candidates.map((candidate) => {
      const breakdown = this.scoreMockCandidate(
        candidate,
        requiredSkills,
        budgetMax,
      );
      const score = Object.values(breakdown).reduce(
        (sum, value) => sum + value,
        0,
      );
      const candidateSkills = this.candidateSkillNames(candidate);
      const matchedSkills = requiredSkills.filter((skill) =>
        candidateSkills.includes(skill.toLowerCase()),
      );
      const missingSkills = requiredSkills.filter(
        (skill) => !candidateSkills.includes(skill.toLowerCase()),
      );

      return {
        freelancerProfileId: candidate.freelancerProfileId,
        score: Number(score.toFixed(2)),
        scoreBreakdown: breakdown,
        rationale: this.buildMockRationale(
          dto.targetRoleKey,
          matchedSkills,
          candidate,
        ),
        evidence: {
          matchedSkills,
          missingSkills,
          availabilityHours: candidate.availabilityHours ?? null,
          hourlyRate: candidate.hourlyRate ?? null,
          averageSkillScore: candidate.averageSkillScore ?? null,
          riskFlags: this.buildMockRiskFlags(candidate, budgetMax),
        },
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const candidates = scored.slice(0, limit).map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));

    return {
      targetRoleKey: dto.targetRoleKey,
      summary: `${candidates.length} approved ${dto.targetRoleKey} candidates ranked for this project.`,
      candidates,
      source: 'local_mock',
    };
  }

  private scoreMockCandidate(
    candidate: MatchCandidateInputDto,
    requiredSkills: string[],
    budgetMax: number | null,
  ): Record<string, number> {
    const candidateSkills = this.candidateSkillNames(candidate);
    const matched = requiredSkills.filter((skill) =>
      candidateSkills.includes(skill.toLowerCase()),
    ).length;
    const skillRatio =
      requiredSkills.length > 0 ? matched / requiredSkills.length : 0.5;

    const availability = candidate.availabilityHours ?? 0;
    const rate = candidate.hourlyRate ?? null;
    const avgSkillScore = candidate.averageSkillScore ?? 0;
    const years = candidate.yearsExperience ?? 0;

    const rateFit =
      rate == null || budgetMax == null
        ? 8
        : rate * 40 <= budgetMax
          ? 12
          : rate * 40 <= budgetMax * 1.25
            ? 8
            : 3;

    return {
      skills: Number((skillRatio * 40).toFixed(2)),
      availability: Number(((Math.min(availability, 40) / 40) * 15).toFixed(2)),
      experience: Number(((Math.min(years, 8) / 8) * 18).toFixed(2)),
      rateFit,
      projectFit: Number(((Math.min(avgSkillScore, 5) / 5) * 15).toFixed(2)),
    };
  }

  private getRoleRequiredSkills(dto: MatchFreelancersDto): string[] {
    const filterSkills = Array.isArray(dto.project?.requiredSkills)
      ? (dto.project.requiredSkills as unknown[]).filter(
          (skill): skill is string => typeof skill === 'string',
        )
      : [];
    if (filterSkills.length > 0) return filterSkills;

    return dto.targetRoleKey === 'ui_ux'
      ? ['Figma', 'Design Systems', 'User Flows']
      : ['System Architecture', 'NestJS', 'PostgreSQL'];
  }

  private candidateSkillNames(candidate: MatchCandidateInputDto): string[] {
    const fromScores = (candidate.skillScores ?? []).map((entry) =>
      String(entry.skill).toLowerCase(),
    );
    const fromSkills = (candidate.skills ?? []).map((skill) =>
      skill.toLowerCase(),
    );
    return Array.from(new Set([...fromScores, ...fromSkills]));
  }

  private buildMockRationale(
    roleKey: string,
    matchedSkills: string[],
    candidate: MatchCandidateInputDto,
  ): string {
    const skillText =
      matchedSkills.length > 0
        ? `strong in ${matchedSkills.slice(0, 3).join(', ')}`
        : 'limited direct skill overlap';
    const availabilityText =
      (candidate.availabilityHours ?? 0) >= 10
        ? 'good availability'
        : 'low availability';
    return `Candidate for ${roleKey}: ${skillText}, ${availabilityText}.`;
  }

  private buildMockRiskFlags(
    candidate: MatchCandidateInputDto,
    budgetMax: number | null,
  ): string[] {
    const flags: string[] = [];
    if ((candidate.availabilityHours ?? 0) < 10) {
      flags.push('low_availability');
    }
    const rate = candidate.hourlyRate ?? null;
    if (rate != null && budgetMax != null && rate * 40 > budgetMax * 1.25) {
      flags.push('rate_above_budget');
    }
    return flags;
  }

  private toNumber(value: unknown): number | null {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed)
      ? parsed
      : null;
  }

  async generateProjectPlan(
    dto: GenerateProjectPlanDto,
  ): Promise<ProjectPlanResult> {
    if (this.isMockMode()) {
      return this.getMockProjectPlanResult(dto);
    }

    const result = await this.postToFastApi<Partial<ProjectPlanResult>>(
      '/agents/generate-project-plan',
      {
        projectId: dto.projectId,
        project: dto.project,
        brief: dto.brief,
        architectureSubmission: dto.architectureSubmission,
        uiuxSubmission: dto.uiuxSubmission,
        team: dto.team,
        notes: dto.notes,
      },
      'generate-project-plan',
    );

    return {
      summary: result.summary ?? 'Generated implementation plan.',
      assumptions: result.assumptions ?? [],
      timeline: result.timeline ?? {},
      milestones: result.milestones ?? [],
      tasks: result.tasks ?? [],
      teamPlan: result.teamPlan ?? {},
      riskRegister: result.riskRegister ?? [],
      source: 'fastapi',
    };
  }

  private getMockProjectPlanResult(
    dto: GenerateProjectPlanDto,
  ): ProjectPlanResult {
    const currency =
      typeof dto.project?.currency === 'string' ? dto.project.currency : 'EGP';

    const milestones: ProjectPlanMilestone[] = [
      {
        key: 'm1',
        title: 'Foundation and core setup',
        description:
          'Auth, data model, and base API from the architecture plan.',
        orderIndex: 1,
        budgetAmount: 3000,
        currency,
        acceptanceCriteria: [
          'Auth and roles work',
          'Core entities and migrations exist',
        ],
      },
      {
        key: 'm2',
        title: 'Primary product flow',
        description: 'Main user-facing screens and their supporting endpoints.',
        orderIndex: 2,
        budgetAmount: 4000,
        currency,
        acceptanceCriteria: [
          'Main flow works end to end',
          'UI matches the approved UI/UX plan',
        ],
      },
    ];

    const tasks: ProjectPlanTask[] = [
      {
        key: 't1',
        milestoneKey: 'm1',
        title: 'Set up backend project and data model',
        description: 'Scaffold the backend, entities, and migrations.',
        priority: 'high',
        roleKey: 'backend',
        requiredSkills: ['NestJS', 'PostgreSQL'],
        estimatedHours: 12,
        orderIndex: 1,
        acceptanceCriteria: [
          'Migrations run',
          'Entities match the architecture',
        ],
        dependsOn: [],
      },
      {
        key: 't2',
        milestoneKey: 'm1',
        title: 'Implement authentication and roles',
        description: 'Auth guards and role-based access.',
        priority: 'high',
        roleKey: 'backend',
        requiredSkills: ['NestJS', 'JWT'],
        estimatedHours: 10,
        orderIndex: 2,
        acceptanceCriteria: ['Login works', 'Role guards enforced'],
        dependsOn: ['t1'],
      },
      {
        key: 't3',
        milestoneKey: 'm2',
        title: 'Build primary UI screens',
        description: 'Implement the main screens from the UI/UX plan.',
        priority: 'medium',
        roleKey: 'frontend',
        requiredSkills: ['React', 'TypeScript'],
        estimatedHours: 16,
        orderIndex: 1,
        acceptanceCriteria: ['Screens responsive', 'Matches design system'],
        dependsOn: ['t2'],
      },
    ];

    return {
      summary:
        'Build the product in two milestones: foundation, then core flow.',
      assumptions: ['Scope follows the approved architecture and UI/UX plans.'],
      timeline: { totalWeeks: 4, milestones: milestones.length },
      milestones,
      tasks,
      teamPlan: { backend: 1, frontend: 1 },
      riskRegister: [
        {
          risk: 'Scope creep beyond the approved plan',
          severity: 'medium',
          mitigation: 'Lock scope to the materialized tasks.',
        },
      ],
      source: 'local_mock',
    };
  }

  private getMockExtractCvResult(dto: ExtractCvDto) {
    return {
      cvUrl: dto.cvUrl,
      skills: ['React', 'NestJS', 'PostgreSQL'],
      yearsExperience: 2,
      headline: 'Full-stack developer',
      summary: 'Mock CV extraction result.',
    };
  }

  private getMockGenerateEmbeddingResult(dto: GenerateEmbeddingDto) {
    const dimensions = dto.dimensions ?? 1024;
    const values = Array.from({ length: dimensions }, (_, index) => {
      const hash = createHash('sha256')
        .update(`${dto.model ?? 'mock'}:${index}:${dto.text}`)
        .digest();
      return hash.readUInt32BE(0) / 0xffffffff - 0.5;
    });
    const magnitude =
      Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;

    return {
      embedding: values.map((value) => Number((value / magnitude).toFixed(8))),
      model: dto.model ?? 'mock-profile-embedding-v1',
      dimensions,
    };
  }

  async validateBrief(dto: BriefDto): Promise<ValidateBriefResult> {
    const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL');

    if (this.isMockMode()) {
      return this.getMockValidateBriefResult(dto);
    }

    if (!aiServiceUrl) {
      throw new BadGatewayException('AI_SERVICE_URL is not configured');
    }

    try {
      return await this.callFastApiValidateBrief(aiServiceUrl, dto);
    } catch (error) {
      this.logger.error(
        `AI service validate-brief failed: ${this.getErrorMessage(error)}`,
      );

      throw new BadGatewayException(
        'AI service is unavailable or returned an invalid response',
      );
    }
  }

  private isMockMode() {
    return (
      (this.configService.get<string>('AI_MOCK_MODE') ?? 'false') === 'true'
    );
  }

  private getAiServiceUrl() {
    const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL');
    if (!aiServiceUrl) {
      throw new BadGatewayException('AI_SERVICE_URL is not configured');
    }
    return aiServiceUrl.replace(/\/+$/, '');
  }

  private getAiServiceTimeoutMs() {
    const configuredTimeoutMs = Number(
      this.configService.get<string>('AI_SERVICE_TIMEOUT_MS'),
    );
    return Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
      ? configuredTimeoutMs
      : 120000;
  }

  private async postToFastApi<T>(
    path: string,
    body: Record<string, unknown>,
    operation: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.getAiServiceTimeoutMs(),
    );

    try {
      const response = await fetch(`${this.getAiServiceUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.stripUndefined(body)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `AI service failed with status ${response.status}: ${errorBody}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      this.logger.error(
        `AI service ${operation} failed: ${this.getErrorMessage(error)}`,
      );
      throw new BadGatewayException(
        `AI service ${operation} failed: ${this.getErrorMessage(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private stripUndefined(body: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined),
    );
  }

  private async callFastApiValidateBrief(
    aiServiceUrl: string,
    dto: BriefDto,
  ): Promise<ValidateBriefResult> {
    const configuredTimeoutMs = Number(
      this.configService.get<string>('AI_SERVICE_TIMEOUT_MS'),
    );
    const timeoutMs =
      Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
        ? configuredTimeoutMs
        : 5000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${aiServiceUrl.replace(/\/+$/, '')}/agents/validate-brief`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: dto.projectId,
            briefId: dto.briefId,
            latestMessage: dto.briefText,
            currentBrief: dto.currentBrief,
            recentMessages: dto.recentMessages ?? [],
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `AI service failed with status ${response.status}: ${errorBody}`,
        );
      }

      const result = (await response.json()) as FastApiValidateBriefResponse;
      const missingFields = result.missingFields ?? [];
      const extractedFields = this.sanitizeExtractedFields(
        result.extractedFields,
      );
      const assistantReply = this.cleanAssistantReply(result.assistantReply);

      return {
        projectId: dto.projectId ?? null,
        briefId: dto.briefId ?? null,
        isComplete: result.isComplete ?? missingFields.length === 0,
        completionPercentage:
          result.completionPercentage ??
          Math.max(40, 100 - missingFields.length * 20),
        missingFields,
        suggestedReply:
          assistantReply ??
          result.nextQuestion ??
          'The brief has enough detail to continue.',
        assistantReply,
        extractedFields,
        nextQuestionField: result.nextQuestionField ?? null,
        fastPathUsed: result.fastPathUsed ?? false,
        fastPathReason: result.fastPathReason ?? null,
        extractionSource: result.extractionSource,
        source: 'fastapi',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private getMockValidateBriefResult(dto: BriefDto): ValidateBriefResult {
    const extractedFields = {
      ...this.getKnownBriefFields(dto),
      ...this.extractFieldsFromText(dto.briefText),
    };
    const missingFields: string[] = [];

    if (!this.hasFieldValue(extractedFields.mainGoal)) {
      missingFields.push('mainGoal');
    }

    if (!this.hasFieldValue(extractedFields.targetUsers)) {
      missingFields.push('targetUsers');
    }

    if (!this.hasFieldValue(extractedFields.coreFeatures)) {
      missingFields.push('coreFeatures');
    }

    if (
      !this.hasFieldValue(extractedFields.platforms) &&
      !this.hasFieldValue(extractedFields.constraintsPreferences)
    ) {
      missingFields.push('platforms');
    }

    if (!this.hasFieldValue(extractedFields.deadline)) {
      missingFields.push('deadline');
    }

    if (!this.hasFieldValue(extractedFields.budget)) {
      missingFields.push('budget');
    }

    const requiredCount = 6;
    const completedCount = requiredCount - missingFields.length;

    return {
      projectId: dto.projectId ?? null,
      briefId: dto.briefId ?? null,
      isComplete: missingFields.length === 0,
      completionPercentage: Math.round((completedCount / requiredCount) * 100),
      missingFields,
      suggestedReply:
        missingFields.length > 0
          ? this.getNextMockBriefQuestion(missingFields[0])
          : 'The brief has enough detail to continue.',
      extractedFields,
      nextQuestionField: missingFields[0] ?? null,
      source: 'local_mock',
    };
  }

  private cleanAssistantReply(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const cleaned = value.trim().replace(/\s+/g, ' ');
    return cleaned.length > 0 ? this.truncate(cleaned, 700) : null;
  }

  private getKnownBriefFields(dto: BriefDto): Record<string, unknown> {
    const currentBrief = this.asPlainObject(dto.currentBrief) ?? {};
    const knownFields = this.asPlainObject(currentBrief.knownFields) ?? {};

    return { ...knownFields };
  }

  private extractFieldsFromText(text: string): Record<string, unknown> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const lowered = normalized.toLowerCase();
    const fields: Record<string, unknown> = {};

    const mainGoal =
      this.extractAfterMarker(normalized, [
        'main goal is',
        'goal is',
        'i want to build',
        'we want to build',
        'i need',
        'we need',
      ]) ?? (normalized.split(/\s+/).length >= 6 ? normalized : null);
    if (mainGoal) fields.mainGoal = mainGoal;

    const targetUsers = this.extractListAfterMarker(normalized, [
      'target users are',
      'target users',
      'users are',
      'for users',
      'for customers',
      'for clients',
      'for patients',
      'for admins',
      'for freelancers',
    ]);
    if (targetUsers.length > 0) fields.targetUsers = targetUsers;

    const coreFeatures = this.extractListAfterMarker(normalized, [
      'core features are',
      'features are',
      'features include',
      'must have',
      'must-have',
    ]);
    if (coreFeatures.length > 0) fields.coreFeatures = coreFeatures;

    const platforms = this.extractListAfterMarker(normalized, [
      'preferred tech is',
      'tech stack is',
      'tech is',
      'using',
      'built with',
    ]);
    if (platforms.length > 0) fields.platforms = platforms;

    const budget =
      this.extractAfterMarker(normalized, ['budget is', 'budget']) ??
      this.extractCurrencyValue(normalized);
    if (budget) fields.budget = budget;

    const deadline = this.extractAfterMarker(normalized, [
      'timeline is',
      'timeline',
      'deadline is',
      'deadline',
      'due',
    ]);
    if (deadline) fields.deadline = deadline;

    if (lowered.includes('no preference')) {
      fields.constraintsPreferences = ['No tech preference'];
    }

    return fields;
  }

  private extractAfterMarker(text: string, markers: string[]): string | null {
    const lowered = text.toLowerCase();

    for (const marker of markers) {
      const index = lowered.indexOf(marker);
      if (index < 0) continue;

      const start = index + marker.length;
      const value = text
        .slice(start)
        .split(/[.;\n]/)[0]
        .replace(/^[:\s-]+/, '')
        .trim();

      if (value) return this.truncate(value, 240);
    }

    return null;
  }

  private extractListAfterMarker(text: string, markers: string[]): string[] {
    const value = this.extractAfterMarker(text, markers);
    if (!value) return [];

    return value
      .split(/,|;|\band\b/gi)
      .map((item) => this.truncate(item.trim(), 120))
      .filter(Boolean)
      .slice(0, 8);
  }

  private extractCurrencyValue(text: string): string | null {
    const match = text.match(
      /(?:\$|egp|usd|eur|gbp)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:egp|usd|eur|gbp|dollars?)/i,
    );

    return match ? match[0] : null;
  }

  private hasFieldValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) {
      return value.some((item) => this.hasFieldValue(item));
    }
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  }

  private asPlainObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }

  private getNextMockBriefQuestion(field: string) {
    const questions: Record<string, string> = {
      mainGoal:
        'What is the main goal of the project? Include the business problem it should solve.',
      targetUsers:
        'Who are the target users? Tell me who will use it and what they need to do.',
      coreFeatures:
        'What are the core features? List the must-have workflows or screens.',
      platforms:
        'Any tech preferences or platform requirements? If not, say no preference.',
      deadline: 'What timeline or deadline should we plan around?',
      budget: 'What budget or budget range should we use for planning?',
    };

    return questions[field] ?? 'Please add more detail for the project brief.';
  }

  private getMockGenerateAssessmentResult(dto: GenerateAssessmentDto) {
    const questionCount = dto.questionCount ?? Math.min(dto.skills.length, 5);
    const selectedSkills = dto.skills.slice(0, questionCount);

    return {
      assessmentId: 'mock-assessment',
      durationSeconds: dto.durationSeconds ?? 1800,
      generatedFrom: {
        cvUrl: dto.cvUrl ?? null,
        headline: dto.headline ?? null,
        yearsExperience: dto.yearsExperience ?? null,
        skills: dto.skills,
      },
      questions: selectedSkills.map((skill, index) => ({
        id: `mock-question-${index + 1}`,
        questionType: 'short_answer',
        skill,
        difficulty: this.getDifficulty(dto.yearsExperience),
        prompt: `Describe one practical ${skill} problem you solved and how you approached it.`,
        rubric: {
          maxScore: 100,
          gradingNotes:
            'Look for practical examples, trade-off reasoning, and clear ownership of the work.',
          correctChoiceId: null,
        },
        orderIndex: index + 1,
      })),
    };
  }

  private getMockGradeAssessmentResult(dto: GradeAssessmentDto) {
    const answeredCount = dto.answers.filter((answer) =>
      this.hasMeaningfulAnswer(answer.answer),
    ).length;
    const totalQuestions = dto.answers.length;
    const percentage =
      totalQuestions === 0
        ? 0
        : Math.round((answeredCount / totalQuestions) * 100);

    return {
      assessmentId: dto.assessmentId,
      score: percentage,
      maxScore: 100,
      recommendation: this.getRecommendation(percentage),
      feedback:
        percentage >= 70
          ? 'Mock grading: answers show enough coverage to move forward.'
          : 'Mock grading: answers need review before approval.',
      profileSummary:
        'Mock grading summary: the freelancer showed practical coverage across submitted answers. Replace with AI grading output in production.',
      questionResults: dto.answers.map((answer) => ({
        questionId: answer.questionId,
        score: this.hasMeaningfulAnswer(answer.answer) ? 100 : 0,
        maxScore: 100,
        feedback: this.hasMeaningfulAnswer(answer.answer)
          ? 'Answered.'
          : 'No meaningful answer submitted.',
      })),
    };
  }

  private getDifficulty(yearsExperience?: number) {
    if (yearsExperience === undefined) return 'mid';
    if (yearsExperience < 2) return 'junior';
    if (yearsExperience < 5) return 'mid';
    return 'senior';
  }

  private getRecommendation(percentage: number) {
    if (percentage >= 75) return 'pass';
    if (percentage >= 50) return 'needs_review';
    return 'fail';
  }

  private hasMeaningfulAnswer(answer: unknown) {
    if (typeof answer === 'string') return answer.trim().length > 0;
    if (Array.isArray(answer)) return answer.length > 0;
    if (answer && typeof answer === 'object')
      return Object.keys(answer).length > 0;
    return answer !== null && answer !== undefined;
  }

  private sanitizeExtractedFields(
    extractedFields?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!extractedFields) return undefined;

    const sanitized: Record<string, unknown> = {};

    for (const [field, value] of Object.entries(extractedFields)) {
      if (!REQUIREMENT_FIELD_NAMES.includes(field)) continue;

      if (typeof value === 'string') {
        const cleanValue = this.cleanFieldValue(field, value);
        if (cleanValue) sanitized[field] = cleanValue;
        continue;
      }

      if (Array.isArray(value)) {
        const cleanValues = this.cleanFieldList(field, value);
        if (cleanValues.length > 0) sanitized[field] = cleanValues;
        continue;
      }

      if (typeof value === 'number' && Number.isFinite(value)) {
        sanitized[field] = value;
      }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  private cleanFieldList(field: string, values: unknown[]): string[] {
    const cleanValues: string[] = [];

    for (const item of values) {
      if (typeof item !== 'string') continue;
      if (this.isFieldLabel(item)) break;

      const cleanValue = this.cleanFieldValue(field, item);
      if (cleanValue) cleanValues.push(cleanValue);
    }

    return cleanValues;
  }

  private cleanFieldValue(field: string, value: string): string | null {
    let cleaned = value.trim();
    if (!cleaned || this.isFieldLabel(cleaned)) return null;

    const lowered = cleaned.toLowerCase();
    for (const marker of FIELD_LABEL_MARKERS) {
      const index = lowered.indexOf(marker);
      if (index === 0) return null;
      if (index > 0) {
        cleaned = cleaned
          .slice(0, index)
          .trim()
          .replace(/[ ,;.-]+$/, '');
        break;
      }
    }

    if (field === 'targetUsers' && this.looksLikeNonTargetUserValue(cleaned)) {
      return null;
    }

    return cleaned || null;
  }

  private isFieldLabel(value: string) {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[\s_]/g, '')
      .replace(/:$/, '');

    return REQUIREMENT_FIELD_NAMES.some(
      (field) => field.toLowerCase() === normalized,
    );
  }

  private looksLikeNonTargetUserValue(value: string) {
    const lowered = value.toLowerCase();
    const blockedFragments = [
      'business domain',
      'clinic management',
      'main goal',
      'booking appointments',
      'manage doctors',
      'manage branches',
      'payments',
      'schedules',
      'system should',
    ];

    return blockedFragments.some((fragment) => lowered.includes(fragment));
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
