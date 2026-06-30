import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BriefDto } from './dto/BriefDto';
import { ExtractCvDto } from './dto/ExtractCvDto';
import { GenerateAssessmentDto } from './dto/GenerateAssessmentDto';
import { GradeAssessmentDto } from './dto/GradeAssessmentDto';

type ValidateBriefResult = {
  projectId: string | null;
  briefId: string | null;
  isComplete: boolean;
  completionPercentage: number;
  missingFields: string[];
  suggestedReply: string;
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
  nextQuestionField?: string | null;
  extractedFields?: Record<string, unknown>;
  missingFields?: string[];
  fastPathUsed?: boolean;
  fastPathReason?: string | null;
  extractionSource?: string;
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

  extractCv(dto: ExtractCvDto) {
    return {
      cvUrl: dto.cvUrl,
      skills: ['React', 'NestJS', 'PostgreSQL'],
      yearsExperience: 2,
      headline: 'Full-stack developer',
      summary: 'Mock CV extraction result.',
    };
  }

  async validateBrief(dto: BriefDto): Promise<ValidateBriefResult> {
    const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL');
    const isMockMode =
      (this.configService.get<string>('AI_MOCK_MODE') ?? 'false') === 'true';

    if (aiServiceUrl && !isMockMode) {
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

    if (!isMockMode) {
      throw new BadGatewayException('AI_SERVICE_URL is not configured');
    }

    return this.getMockValidateBriefResult(dto);
  }

  private async callFastApiValidateBrief(
    aiServiceUrl: string,
    dto: BriefDto,
  ): Promise<ValidateBriefResult> {
    const timeoutMs = Number(
      this.configService.get<string>('AI_SERVICE_TIMEOUT_MS') ?? 5000,
    );
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

      return {
        projectId: dto.projectId ?? null,
        briefId: dto.briefId ?? null,
        isComplete: result.isComplete ?? missingFields.length === 0,
        completionPercentage:
          result.completionPercentage ??
          Math.max(40, 100 - missingFields.length * 20),
        missingFields,
        suggestedReply:
          result.nextQuestion ?? 'The brief has enough detail to continue.',
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
    const briefText = dto.briefText.toLowerCase();
    const missingFields: string[] = [];

    if (!briefText.includes('budget')) missingFields.push('budget');

    if (!briefText.includes('deadline') && !briefText.includes('timeline')) {
      missingFields.push('deadline');
    }

    if (!briefText.includes('deliverable')) {
      missingFields.push('deliverables');
    }

    return {
      projectId: dto.projectId ?? null,
      briefId: dto.briefId ?? null,
      isComplete: missingFields.length === 0,
      completionPercentage: Math.max(40, 100 - missingFields.length * 20),
      missingFields,
      suggestedReply:
        missingFields.length > 0
          ? `Please add: ${missingFields.join(', ')}.`
          : 'The brief has enough detail to continue.',
      source: 'local_mock',
    };
  }

  generateAssessment(dto: GenerateAssessmentDto) {
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
        orderIndex: index + 1,
      })),
    };
  }

  gradeAssessment(dto: GradeAssessmentDto) {
    const answeredCount = dto.answers.filter((answer) =>
      this.hasMeaningfulAnswer(answer.answer),
    ).length;
    const totalQuestions = dto.answers.length;
    const percentage =
      totalQuestions === 0
        ? 0
        : Math.round((answeredCount / totalQuestions) * 100);

    return {
      assessmentId: dto.assessmentId ?? null,
      score: percentage,
      maxScore: 100,
      recommendation: this.getRecommendation(percentage),
      feedback:
        percentage >= 70
          ? 'Mock grading: answers show enough coverage to move forward.'
          : 'Mock grading: answers need review before approval.',
      questionResults: dto.answers.map((answer) => ({
        questionId: answer.questionId,
        score: this.hasMeaningfulAnswer(answer.answer) ? 100 : 0,
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
