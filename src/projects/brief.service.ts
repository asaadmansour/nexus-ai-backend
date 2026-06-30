import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBriefMessageDto } from './dtos/create-brief-message.dto';
import { BriefMessage } from './entities/brief-message.entity';
import { Brief } from './entities/brief.entity';
import { Project } from './entities/project.entity';
import { AiService } from 'src/agents/ai.service';

const RECENT_BRIEF_MESSAGE_LIMIT = 5;
const MAX_SUMMARY_LENGTH = 1000;
const MAX_BRIEF_TEXT_LENGTH = 5000;

type ExtractedBriefFields = Record<string, unknown>;

@Injectable()
export class BriefService {
  constructor(
    @InjectRepository(Brief)
    private readonly briefRepo: Repository<Brief>,
    @InjectRepository(BriefMessage)
    private readonly briefMessageRepo: Repository<BriefMessage>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly aiService: AiService,
  ) {}

  async sendCustomerMessage(projectId: string, dto: CreateBriefMessageDto) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    let brief = await this.briefRepo.findOne({
      where: { projectId },
    });

    if (!brief) {
      brief = this.briefRepo.create({
        projectId,
      });

      brief = await this.briefRepo.save(brief);
    }

    const currentBrief = this.buildCurrentBriefContext(brief);
    const recentMessages = await this.getRecentMessages(brief.id);

    const customerMessage = this.briefMessageRepo.create({
      briefId: brief.id,
      senderType: 'customer',
      message: dto.content,
      metadata: null,
    });

    await this.briefMessageRepo.save(customerMessage);
    const aiResult = await this.aiService.validateBrief({
      projectId,
      briefId: brief.id,
      briefText: dto.content,
      currentBrief,
      recentMessages,
    });
    const agentMessage = this.briefMessageRepo.create({
      briefId: brief.id,
      senderType: 'agent',
      message: aiResult.suggestedReply,
      metadata: aiResult,
    });
    await this.briefMessageRepo.save(agentMessage);

    const extractedFields =
      aiResult.extractedFields ?? this.getStoredExtractedFields(brief);

    brief.isComplete = aiResult.isComplete;
    brief.completedAt = aiResult.isComplete ? new Date() : null;
    brief.aiDecided = {
      ...(brief.aiDecided ?? {}),
      missingFields: aiResult.missingFields,
      completionPercentage: aiResult.completionPercentage,
      extractedFields: extractedFields ?? null,
      pendingField: aiResult.nextQuestionField ?? null,
      nextQuestionField: aiResult.nextQuestionField ?? null,
      fastPathUsed: aiResult.fastPathUsed ?? false,
      fastPathReason: aiResult.fastPathReason ?? null,
      extractionSource: aiResult.extractionSource ?? aiResult.source,
      source: aiResult.source,
    };
    this.applyExtractedFieldsToBrief(brief, extractedFields, dto.content);

    const updatedBrief = await this.briefRepo.save(brief);
    return {
      brief: updatedBrief,
      customerMessage,
      agentMessage,
      ai: aiResult,
    };
  }

  private async getRecentMessages(briefId: string) {
    const messages = await this.briefMessageRepo.find({
      where: { briefId },
      order: { createdAt: 'DESC' },
      take: RECENT_BRIEF_MESSAGE_LIMIT,
    });

    return messages.reverse().map((message) => ({
      senderType: message.senderType,
      content: message.message,
      createdAt: message.createdAt.toISOString(),
    }));
  }

  private buildCurrentBriefContext(brief: Brief): Record<string, unknown> {
    const knownFields = this.buildKnownFieldsFromBrief(brief);
    const aiDecided = this.asPlainObject(brief.aiDecided) ?? {};
    const pendingField =
      aiDecided &&
      typeof aiDecided === 'object' &&
      !Array.isArray(aiDecided) &&
      'pendingField' in aiDecided
        ? (aiDecided.pendingField as string | null)
        : null;

    return {
      id: brief.id,
      projectId: brief.projectId,
      knownFields,
      pendingField,
      isComplete: brief.isComplete,
      completedAt: brief.completedAt?.toISOString() ?? null,
      summary: brief.summary,
      projectType: brief.projectType,
      domain: brief.domain,
      technical: brief.technical,
      nonFunctional: brief.nonFunctional,
      deliverables: brief.deliverables,
      suggestedTeamSize: brief.suggestedTeamSize,
      preferredTimeline: brief.preferredTimeline,
      isDeadlineFlexible: brief.isDeadlineFlexible,
      deadlineDate: brief.deadlineDate,
      requiredSkills: brief.requiredSkills,
      preferredSkills: brief.preferredSkills,
      experienceLevel: brief.experienceLevel,
      experienceMinYears: brief.experienceMinYears,
      acceptanceCriteria: brief.acceptanceCriteria,
      briefText: brief.briefText,
      aiDecided: brief.aiDecided,
    };
  }

  private applyExtractedFieldsToBrief(
    brief: Brief,
    extractedFields: ExtractedBriefFields | undefined,
    latestMessage: string,
  ) {
    const fields = extractedFields ?? {};

    const projectType = this.toSingleLineText(fields.projectType, 100);
    if (projectType) brief.projectType = projectType;

    const domain = this.toSingleLineText(fields.businessDomain, 100);
    if (domain) brief.domain = domain;

    const clientBackground = this.toSingleLineText(fields.clientBackground, 40);
    if (clientBackground) brief.clientBackground = clientBackground;

    const suggestedTeamSize = this.toPositiveInteger(fields.suggestedTeamSize);
    if (suggestedTeamSize !== null) {
      brief.suggestedTeamSize = suggestedTeamSize;
    }

    const experienceLevel = this.normalizeExperienceLevel(
      this.toSingleLineText(fields.experienceLevel, 40),
    );
    if (experienceLevel) brief.experienceLevel = experienceLevel;

    const experienceMinYears = this.toPositiveInteger(
      fields.experienceMinYears,
    );
    if (experienceMinYears !== null) {
      brief.experienceMinYears = experienceMinYears;
    }

    brief.technical = this.mergeJsonSection(brief.technical, {
      mainGoal: this.toTextValue(fields.mainGoal),
      targetUsers: this.toStringList(fields.targetUsers),
      coreFeatures: this.toStringList(fields.coreFeatures),
      platforms: this.toStringList(fields.platforms),
    });

    brief.nonFunctional = this.mergeJsonSection(brief.nonFunctional, {
      budget: this.toTextValue(fields.budget),
      deadline: this.toTextValue(fields.deadline),
      constraintsPreferences: this.toStringList(fields.constraintsPreferences),
    });

    const deliverables = this.toStringList(fields.deliverables);
    if (deliverables.length > 0) {
      brief.deliverables = this.mergeJsonSection(brief.deliverables, {
        items: deliverables,
      });
    }

    const summary = this.buildBriefSummary(fields);
    if (summary) brief.summary = summary;

    const briefText = this.buildBriefText(fields, latestMessage);
    if (briefText) brief.briefText = briefText;
  }

  private buildKnownFieldsFromBrief(brief: Brief): ExtractedBriefFields | null {
    const storedExtractedFields = this.getStoredExtractedFields(brief) ?? {};
    const technical = this.asPlainObject(brief.technical) ?? {};
    const nonFunctional = this.asPlainObject(brief.nonFunctional) ?? {};
    const deliverables = this.asPlainObject(brief.deliverables) ?? {};

    const knownFields = this.cleanJsonSection({
      ...storedExtractedFields,
      projectType: brief.projectType,
      businessDomain: brief.domain,
      clientBackground: brief.clientBackground,
      suggestedTeamSize: brief.suggestedTeamSize,
      experienceLevel: brief.experienceLevel,
      experienceMinYears: brief.experienceMinYears,
      mainGoal: technical.mainGoal,
      targetUsers: technical.targetUsers,
      coreFeatures: technical.coreFeatures,
      platforms: technical.platforms,
      budget: nonFunctional.budget,
      deadline: nonFunctional.deadline,
      constraintsPreferences: nonFunctional.constraintsPreferences,
      deliverables: deliverables.items,
    });

    return Object.keys(knownFields).length > 0 ? knownFields : null;
  }

  private getStoredExtractedFields(
    brief: Brief,
  ): ExtractedBriefFields | undefined {
    const aiDecided = this.asPlainObject(brief.aiDecided);
    const extractedFields = this.asPlainObject(aiDecided?.extractedFields);

    return extractedFields && Object.keys(extractedFields).length > 0
      ? extractedFields
      : undefined;
  }

  private buildBriefSummary(fields: ExtractedBriefFields): string | null {
    const projectType = this.toTextValue(fields.projectType);
    const domain = this.toTextValue(fields.businessDomain);
    const mainGoal = this.toTextValue(fields.mainGoal);
    const targetUsers = this.toStringList(fields.targetUsers);
    const coreFeatures = this.toStringList(fields.coreFeatures);

    const parts: string[] = [];

    if (projectType && domain) {
      parts.push(`${projectType} for ${domain}`);
    } else if (projectType || domain) {
      parts.push(projectType ?? domain ?? '');
    }

    if (mainGoal) parts.push(`Goal: ${mainGoal}`);
    if (targetUsers.length > 0) {
      parts.push(`Users: ${targetUsers.join(', ')}`);
    }
    if (coreFeatures.length > 0) {
      parts.push(`Core features: ${coreFeatures.slice(0, 6).join(', ')}`);
    }

    const summary = parts.filter(Boolean).join('. ');
    return summary ? this.truncate(summary, MAX_SUMMARY_LENGTH) : null;
  }

  private buildBriefText(
    fields: ExtractedBriefFields,
    latestMessage: string,
  ): string | null {
    const lines = [
      ['Project type', this.toTextValue(fields.projectType)],
      ['Business domain', this.toTextValue(fields.businessDomain)],
      ['Main goal', this.toTextValue(fields.mainGoal)],
      ['Target users', this.toStringList(fields.targetUsers).join(', ')],
      ['Core features', this.toStringList(fields.coreFeatures).join(', ')],
      ['Platforms', this.toStringList(fields.platforms).join(', ')],
      ['Budget', this.toTextValue(fields.budget)],
      ['Deadline', this.toTextValue(fields.deadline)],
      ['Deliverables', this.toStringList(fields.deliverables).join(', ')],
      [
        'Constraints/preferences',
        this.toStringList(fields.constraintsPreferences).join(', '),
      ],
      ['Client background', this.toTextValue(fields.clientBackground)],
      ['Suggested team size', this.toTextValue(fields.suggestedTeamSize)],
      ['Experience level', this.toTextValue(fields.experienceLevel)],
      ['Minimum years', this.toTextValue(fields.experienceMinYears)],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`);

    if (lines.length === 0) {
      return this.truncate(latestMessage.trim(), MAX_BRIEF_TEXT_LENGTH);
    }

    return this.truncate(lines.join('\n'), MAX_BRIEF_TEXT_LENGTH);
  }

  private mergeJsonSection(
    current: Record<string, unknown> | null,
    updates: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const cleanUpdates = this.cleanJsonSection(updates);
    if (Object.keys(cleanUpdates).length === 0) return current;

    return {
      ...(this.asPlainObject(current) ?? {}),
      ...cleanUpdates,
    };
  }

  private cleanJsonSection(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => {
        if (entry === null || entry === undefined) return false;
        if (typeof entry === 'string') return entry.trim().length > 0;
        if (Array.isArray(entry)) return entry.length > 0;
        return true;
      }),
    );
  }

  private toStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.toSingleLineText(item, 160))
        .filter((item): item is string => Boolean(item));
    }

    const text = this.toTextValue(value);
    if (!text) return [];

    return text
      .split(/,|;|\n|\band\b/gi)
      .map((item) => this.toSingleLineText(item, 160))
      .filter((item): item is string => Boolean(item));
  }

  private toTextValue(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value === 'string') {
      const cleaned = value.trim();
      return cleaned.length > 0 ? cleaned : null;
    }

    if (Array.isArray(value)) {
      const text = value
        .map((item) => this.toSingleLineText(item, 160))
        .filter(Boolean)
        .join(', ');

      return text.length > 0 ? text : null;
    }

    return null;
  }

  private toSingleLineText(value: unknown, maxLength: number): string | null {
    const text = this.toTextValue(value);
    if (!text) return null;

    return this.truncate(text.replace(/\s+/g, ' ').trim(), maxLength);
  }

  private toPositiveInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return value;
    }

    const text = this.toTextValue(value)?.toLowerCase();
    if (!text) return null;

    const digitMatch = text.match(/\d+/);
    if (digitMatch) return Number(digitMatch[0]);

    const wordNumbers: Record<string, number> = {
      zero: 0,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };

    for (const [word, number] of Object.entries(wordNumbers)) {
      if (new RegExp(`\\b${word}\\b`).test(text)) return number;
    }

    return null;
  }

  private normalizeExperienceLevel(value: string | null): string | null {
    if (!value) return null;

    const lowered = value.toLowerCase();
    if (lowered.includes('senior')) return 'senior';
    if (lowered.includes('mid')) return 'mid';
    if (lowered.includes('junior')) return 'junior';
    if (lowered.includes('expert')) return 'expert';
    if (lowered.includes('no preference')) return 'no_preference';
    if (lowered.includes('any')) return 'no_preference';

    return this.truncate(value, 20);
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
}
