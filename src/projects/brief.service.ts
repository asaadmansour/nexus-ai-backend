import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateBriefMessageDto } from './dtos/create-brief-message.dto';
import { UpdateBriefDto } from './dtos/update-brief.dto';
import { BriefMessage } from './entities/brief-message.entity';
import { Brief } from './entities/brief.entity';
import { Project } from './entities/project.entity';
import { AiService } from 'src/agents/ai.service';
import { ProjectStatus } from 'src/common/enums/project-status.enum';

const RECENT_BRIEF_MESSAGE_LIMIT = 5;
const MAX_SUMMARY_LENGTH = 1000;
const MAX_BRIEF_TEXT_LENGTH = 5000;
const INITIAL_AGENT_MESSAGE_VERSION = 2;
const MAX_AI_REVISION_MESSAGES = 3;
const INITIAL_GREETING_MESSAGE =
  'The customer opened the requirements chat. Greet them warmly using the project context, acknowledge what the project seems to be about, and ask one helpful next question. Do not ask for project name, project type, budget, or deadline.';
const PROJECT_DERIVED_FIELDS = new Set(['projectType', 'budget', 'deadline']);
const USER_REQUIRED_BRIEF_FIELDS = [
  'businessDomain',
  'mainGoal',
  'targetUsers',
  'coreFeatures',
  'platforms',
  'deliverables',
  'constraintsPreferences',
  'clientBackground',
  'suggestedTeamSize',
  'experienceLevel',
  'experienceMinYears',
];
const BRIEF_CHANGE_LOCKED_PROJECT_STATUSES = new Set<ProjectStatus>([
  ProjectStatus.ASSIGNED,
  ProjectStatus.ACTIVE,
  ProjectStatus.UNDER_REVIEW,
  ProjectStatus.COMPLETED,
  ProjectStatus.DISPUTED,
  ProjectStatus.CANCELLED,
]);

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
    private readonly dataSource: DataSource,
  ) {}

  async getBrief(projectId: string, userId: string, isAdmin: boolean) {
    const project = await this.findAuthorizedProject(
      projectId,
      userId,
      isAdmin,
    );
    const brief = await this.getOrCreateBrief(projectId);
    await this.ensureInitialAgentMessage(brief, project);

    return brief;
  }

  async getMessages(projectId: string, userId: string, isAdmin: boolean) {
    const project = await this.findAuthorizedProject(
      projectId,
      userId,
      isAdmin,
    );
    const brief = await this.getOrCreateBrief(projectId);
    await this.ensureInitialAgentMessage(brief, project);

    return this.briefMessageRepo.find({
      where: { briefId: brief.id },
      order: { createdAt: 'ASC' },
    });
  }

  async sendCustomerMessage(
    projectId: string,
    userId: string,
    isAdmin: boolean,
    dto: CreateBriefMessageDto,
  ) {
    const project = await this.findAuthorizedProject(
      projectId,
      userId,
      isAdmin,
    );
    const brief = await this.getOrCreateBrief(projectId);
    await this.ensureInitialAgentMessage(brief, project);
    const wasComplete = brief.isComplete;
    this.assertAiChatAllowed(project, brief);

    const projectDefaultFields = this.extractProjectDefaultFields(project);
    const currentBrief = this.buildCurrentBriefContext(
      brief,
      projectDefaultFields,
      this.buildProjectContext(project),
    );
    const recentMessages = await this.getRecentMessages(brief.id);

    const customerMessage = this.briefMessageRepo.create({
      briefId: brief.id,
      senderType: 'customer',
      message: dto.content,
      metadata: null,
    });

    const aiResult = await this.aiService.validateBrief({
      projectId,
      briefId: brief.id,
      briefText: dto.content,
      currentBrief,
      recentMessages,
    });
    const extractedFields = this.mergeExtractedFields(
      projectDefaultFields,
      aiResult.extractedFields ?? this.getStoredExtractedFields(brief),
    );
    const visibleMissingFields = this.removeProjectDerivedMissingFields(
      aiResult.missingFields,
    );
    aiResult.suggestedReply = this.resolveAgentReply(
      aiResult.suggestedReply,
      aiResult.assistantReply,
      visibleMissingFields,
      recentMessages,
    );

    const agentMessage = this.briefMessageRepo.create({
      briefId: brief.id,
      senderType: 'agent',
      message: aiResult.suggestedReply,
      metadata: aiResult,
    });

    const isComplete =
      wasComplete || aiResult.isComplete || visibleMissingFields.length === 0;
    const nextRevisionCount = wasComplete
      ? this.getRevisionCount(brief) + 1
      : this.getRevisionCount(brief);
    brief.isComplete = isComplete;
    brief.completedAt = brief.completedAt ?? (isComplete ? new Date() : null);
    brief.aiDecided = {
      ...(brief.aiDecided ?? {}),
      missingFields: visibleMissingFields,
      completionPercentage: aiResult.completionPercentage,
      extractedFields: extractedFields ?? null,
      aiRevisionOpen:
        wasComplete && nextRevisionCount < MAX_AI_REVISION_MESSAGES,
      revisionCount: nextRevisionCount,
      revisionLimit: MAX_AI_REVISION_MESSAGES,
      confirmedAt: wasComplete
        ? null
        : this.asPlainObject(brief.aiDecided)?.confirmedAt,
      pendingField: aiResult.nextQuestionField ?? null,
      nextQuestionField: aiResult.nextQuestionField ?? null,
      fastPathUsed: aiResult.fastPathUsed ?? false,
      fastPathReason: aiResult.fastPathReason ?? null,
      extractionSource: aiResult.extractionSource ?? aiResult.source,
      source: aiResult.source,
    };
    this.applyExtractedFieldsToBrief(brief, extractedFields, dto.content);

    return this.dataSource.transaction(async (manager) => {
      const savedCustomerMessage = await manager.save(
        BriefMessage,
        customerMessage,
      );
      const savedAgentMessage = await manager.save(BriefMessage, agentMessage);
      const updatedBrief = await manager.save(Brief, brief);

      if (
        updatedBrief.isComplete &&
        project.status !== ProjectStatus.BRIEF_COMPLETE
      ) {
        project.status = ProjectStatus.BRIEF_COMPLETE;
        await manager.save(Project, project);
      }

      return {
        brief: updatedBrief,
        customerMessage: savedCustomerMessage,
        agentMessage: savedAgentMessage,
        ai: aiResult,
      };
    });
  }

  async updateBrief(
    projectId: string,
    userId: string,
    isAdmin: boolean,
    dto: UpdateBriefDto,
  ) {
    const project = await this.findAuthorizedProject(
      projectId,
      userId,
      isAdmin,
    );
    this.assertBriefCanChange(project);

    const brief = await this.getOrCreateBrief(projectId);
    const projectDefaultFields = this.extractProjectDefaultFields(project);
    const extractedFields = this.mergeExtractedFields(
      projectDefaultFields,
      this.buildKnownFieldsFromBrief(brief),
      this.extractManualUpdateFields(dto),
    );
    const missingFields =
      this.getVisibleMissingFieldsFromFields(extractedFields);

    this.applyExtractedFieldsToBrief(brief, extractedFields, '');
    brief.isComplete = missingFields.length === 0;
    brief.completedAt =
      brief.completedAt ?? (brief.isComplete ? new Date() : null);
    brief.aiDecided = {
      ...(brief.aiDecided ?? {}),
      missingFields,
      completionPercentage:
        this.getCompletionPercentageFromMissingFields(missingFields),
      extractedFields,
      aiRevisionOpen: false,
      revisionCount: this.getRevisionCount(brief),
      revisionLimit: MAX_AI_REVISION_MESSAGES,
      confirmedAt: null,
      manuallyEditedAt: new Date().toISOString(),
    };

    return this.dataSource.transaction(async (manager) => {
      const updatedBrief = await manager.save(Brief, brief);

      if (
        updatedBrief.isComplete &&
        project.status !== ProjectStatus.BRIEF_COMPLETE
      ) {
        project.status = ProjectStatus.BRIEF_COMPLETE;
        await manager.save(Project, project);
      }

      return updatedBrief;
    });
  }

  async reopenAiHelp(projectId: string, userId: string, isAdmin: boolean) {
    const project = await this.findAuthorizedProject(
      projectId,
      userId,
      isAdmin,
    );
    this.assertBriefCanChange(project);

    const brief = await this.getOrCreateBrief(projectId);
    if (!brief.isComplete) {
      throw new BadRequestException('The requirements chat is already open.');
    }

    const revisionCount = this.getRevisionCount(brief);
    if (revisionCount >= MAX_AI_REVISION_MESSAGES) {
      throw new BadRequestException(
        'AI revision limit reached. You can still edit the brief fields manually.',
      );
    }

    brief.aiDecided = {
      ...(brief.aiDecided ?? {}),
      aiRevisionOpen: true,
      revisionCount,
      revisionLimit: MAX_AI_REVISION_MESSAGES,
      confirmedAt: null,
      reopenedAt: new Date().toISOString(),
    };
    const updatedBrief = await this.dataSource.transaction(async (manager) => {
      const updatedBrief = await manager.save(Brief, brief);

      await manager.save(
        BriefMessage,
        manager.create(BriefMessage, {
          briefId: brief.id,
          senderType: 'agent',
          message:
            'Sure, tell me what you want to change or clarify. I can help with a few focused revisions, or you can edit the brief fields directly.',
          metadata: {
            systemPrompt: true,
            aiRevisionOpen: true,
            revisionCount,
            revisionLimit: MAX_AI_REVISION_MESSAGES,
          },
        }),
      );

      return updatedBrief;
    });

    return {
      brief: updatedBrief,
      messages: await this.getMessages(projectId, userId, isAdmin),
    };
  }

  async confirmBrief(projectId: string, userId: string, isAdmin: boolean) {
    const project = await this.findAuthorizedProject(
      projectId,
      userId,
      isAdmin,
    );
    this.assertBriefCanChange(project);

    const brief = await this.getOrCreateBrief(projectId);
    const missingFields = this.getVisibleMissingFieldsFromFields(
      this.mergeExtractedFields(
        this.extractProjectDefaultFields(project),
        this.buildKnownFieldsFromBrief(brief),
      ),
    );

    if (missingFields.length > 0) {
      throw new BadRequestException(
        'Please complete the required brief details before confirming.',
      );
    }

    brief.isComplete = true;
    brief.completedAt = brief.completedAt ?? new Date();
    brief.aiDecided = {
      ...(brief.aiDecided ?? {}),
      missingFields: [],
      completionPercentage: 100,
      aiRevisionOpen: false,
      revisionCount: this.getRevisionCount(brief),
      revisionLimit: MAX_AI_REVISION_MESSAGES,
      confirmedAt: new Date().toISOString(),
      confirmedBy: userId,
    };

    return this.dataSource.transaction(async (manager) => {
      const updatedBrief = await manager.save(Brief, brief);

      if (project.status !== ProjectStatus.BRIEF_COMPLETE) {
        project.status = ProjectStatus.BRIEF_COMPLETE;
        await manager.save(Project, project);
      }

      return updatedBrief;
    });
  }

  private resolveAgentReply(
    suggestedReply: string,
    assistantReply: string | null | undefined,
    missingFields: string[],
    recentMessages: Array<{ senderType: string; content: string }>,
  ) {
    if (assistantReply) {
      return assistantReply;
    }

    if (missingFields.length === 0) {
      return 'Thanks, the brief has enough detail to continue.';
    }

    const fallbackPrompt = this.buildNaturalFollowUpPrompt(missingFields[0]);

    const lastAgentMessage = [...recentMessages]
      .reverse()
      .find((message) => message.senderType === 'agent');

    if (
      suggestedReply &&
      (!lastAgentMessage ||
        this.normalizeComparableText(lastAgentMessage.content) !==
          this.normalizeComparableText(suggestedReply))
    ) {
      return suggestedReply;
    }

    return fallbackPrompt;
  }

  private normalizeComparableText(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private humanizeFieldName(value: string) {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^./, (letter) => letter.toUpperCase());
  }

  private async findAuthorizedProject(
    projectId: string,
    userId: string,
    isAdmin: boolean,
  ) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (!isAdmin && project.customerId !== userId) {
      throw new ForbiddenException('You can only access your own projects');
    }

    return project;
  }

  private async getOrCreateBrief(projectId: string) {
    let brief = await this.briefRepo.findOne({
      where: { projectId },
    });

    if (!brief) {
      brief = this.briefRepo.create({
        projectId,
      });

      brief = await this.briefRepo.save(brief);
    }

    return brief;
  }

  private async ensureInitialAgentMessage(brief: Brief, project: Project) {
    const firstAgentMessage = await this.briefMessageRepo.findOne({
      where: { briefId: brief.id, senderType: 'agent' },
      order: { createdAt: 'ASC' },
    });

    if (firstAgentMessage) {
      if (
        firstAgentMessage.metadata?.systemPrompt === true &&
        firstAgentMessage.metadata?.initialAgentMessageVersion !==
          INITIAL_AGENT_MESSAGE_VERSION
      ) {
        firstAgentMessage.message = await this.buildInitialAgentMessage(
          brief,
          project,
        );
        firstAgentMessage.metadata = {
          ...(firstAgentMessage.metadata ?? {}),
          systemPrompt: true,
          initialAgentMessageVersion: INITIAL_AGENT_MESSAGE_VERSION,
        };
        await this.briefMessageRepo.save(firstAgentMessage);
      }

      return;
    }

    await this.briefMessageRepo.save(
      this.briefMessageRepo.create({
        briefId: brief.id,
        senderType: 'agent',
        message: await this.buildInitialAgentMessage(brief, project),
        metadata: {
          systemPrompt: true,
          initialAgentMessageVersion: INITIAL_AGENT_MESSAGE_VERSION,
        },
      }),
    );
  }

  private async buildInitialAgentMessage(brief: Brief, project: Project) {
    const projectDefaultFields = this.extractProjectDefaultFields(project);
    const currentBrief = this.buildCurrentBriefContext(
      brief,
      projectDefaultFields,
      this.buildProjectContext(project),
      'initialGreeting',
    );

    try {
      const aiResult = await this.aiService.validateBrief({
        projectId: project.id,
        briefId: brief.id,
        briefText: INITIAL_GREETING_MESSAGE,
        currentBrief,
        recentMessages: [],
      });
      const extractedFields = this.mergeExtractedFields(
        projectDefaultFields,
        aiResult.extractedFields,
      );
      const missingFields = this.removeProjectDerivedMissingFields(
        aiResult.missingFields,
      );

      brief.aiDecided = {
        ...(brief.aiDecided ?? {}),
        missingFields,
        completionPercentage: aiResult.completionPercentage,
        extractedFields: extractedFields ?? null,
        pendingField: aiResult.nextQuestionField ?? null,
        nextQuestionField: aiResult.nextQuestionField ?? null,
        extractionSource: aiResult.extractionSource ?? aiResult.source,
        source: aiResult.source,
      };
      this.applyExtractedFieldsToBrief(brief, extractedFields, '');
      await this.briefRepo.save(brief);

      return this.resolveAgentReply(
        aiResult.suggestedReply,
        aiResult.assistantReply,
        missingFields,
        [],
      );
    } catch {
      return this.buildInitialFallbackMessage(project);
    }
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

  private assertAiChatAllowed(project: Project, brief: Brief) {
    if (!brief.isComplete) return;

    this.assertBriefCanChange(project);
    const aiDecided = this.asPlainObject(brief.aiDecided) ?? {};
    const aiRevisionOpen = aiDecided.aiRevisionOpen === true;

    if (!aiRevisionOpen) {
      throw new BadRequestException(
        'The brief is complete. Reopen AI help or edit the brief fields directly.',
      );
    }

    if (this.getRevisionCount(brief) >= MAX_AI_REVISION_MESSAGES) {
      throw new BadRequestException(
        'AI revision limit reached. You can still edit the brief fields manually.',
      );
    }
  }

  private assertBriefCanChange(project: Project) {
    if (BRIEF_CHANGE_LOCKED_PROJECT_STATUSES.has(project.status)) {
      throw new BadRequestException(
        'The brief cannot be changed after the project is assigned or closed.',
      );
    }
  }

  private extractProjectDefaultFields(project: Project): ExtractedBriefFields {
    const fields: ExtractedBriefFields = {};
    const budget = this.formatProjectBudget(project);

    if (project.title) fields.projectType = project.title;
    if (project.description) fields.mainGoal = project.description;
    if (budget) fields.budget = budget;
    if (project.deadline) {
      fields.deadline = project.deadline.toISOString().slice(0, 10);
    }

    return fields;
  }

  private formatProjectBudget(project: Project): string | null {
    if (!project.budgetMin && !project.budgetMax) return null;

    const currency = project.currency || 'EGP';
    if (project.budgetMin === project.budgetMax) {
      return `${currency} ${project.budgetMin}`;
    }

    return `${currency} ${project.budgetMin} - ${project.budgetMax}`;
  }

  private buildProjectContext(project: Project) {
    return {
      name: project.title,
      title: project.title,
      description: project.description,
      budget: this.formatProjectBudget(project),
      deadline: project.deadline?.toISOString().slice(0, 10) ?? null,
      isDeadlineFlexible: project.isDeadlineFlexible,
    };
  }

  private mergeExtractedFields(
    ...fieldSets: Array<ExtractedBriefFields | null | undefined>
  ): ExtractedBriefFields {
    const merged: ExtractedBriefFields = {};

    for (const fieldSet of fieldSets) {
      if (!fieldSet) continue;

      for (const [field, value] of Object.entries(fieldSet)) {
        if (this.hasFieldValue(value)) {
          merged[field] = value;
        }
      }
    }

    return merged;
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

  private buildCurrentBriefContext(
    brief: Brief,
    extraKnownFields?: ExtractedBriefFields,
    projectContext?: Record<string, unknown>,
    conversationMode?: string,
  ): Record<string, unknown> {
    const knownFields = this.mergeExtractedFields(
      this.buildKnownFieldsFromBrief(brief),
      extraKnownFields,
    );
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
      knownFields: Object.keys(knownFields).length > 0 ? knownFields : null,
      projectContext: projectContext ?? null,
      conversationMode: conversationMode ?? null,
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

  private removeProjectDerivedMissingFields(missingFields: string[]) {
    return missingFields.filter((field) => !PROJECT_DERIVED_FIELDS.has(field));
  }

  private getVisibleMissingFieldsFromFields(fields: ExtractedBriefFields) {
    return USER_REQUIRED_BRIEF_FIELDS.filter(
      (field) => !this.hasFieldValue(fields[field]),
    );
  }

  private getCompletionPercentageFromMissingFields(missingFields: string[]) {
    const completedFields =
      USER_REQUIRED_BRIEF_FIELDS.length - missingFields.length;
    return Math.round(
      (completedFields / USER_REQUIRED_BRIEF_FIELDS.length) * 100,
    );
  }

  private getRevisionCount(brief: Brief) {
    const aiDecided = this.asPlainObject(brief.aiDecided);
    const revisionCount = aiDecided?.revisionCount;

    return typeof revisionCount === 'number' && Number.isFinite(revisionCount)
      ? revisionCount
      : 0;
  }

  private extractManualUpdateFields(dto: UpdateBriefDto): ExtractedBriefFields {
    return this.cleanJsonSection({
      businessDomain: dto.businessDomain,
      mainGoal: dto.mainGoal,
      targetUsers: dto.targetUsers,
      coreFeatures: dto.coreFeatures,
      platforms: dto.platforms,
      deliverables: dto.deliverables,
      constraintsPreferences: dto.constraintsPreferences,
      clientBackground: dto.clientBackground,
      suggestedTeamSize: dto.suggestedTeamSize,
      experienceLevel: dto.experienceLevel,
      experienceMinYears: dto.experienceMinYears,
    });
  }

  private buildInitialFallbackMessage(project: Project) {
    const projectName = project.title || 'your project';
    const description = project.description
      ? ` I saw the short description: ${this.truncate(project.description, 160)}.`
      : '';

    return `Hi, I’ll help shape ${projectName} into a clear brief.${description} To start, tell me a bit about the business or domain this is for and who you expect to use it.`;
  }

  private buildNaturalFollowUpPrompt(nextField: string) {
    const questions: Record<string, string> = {
      businessDomain:
        'Nice, that gives me a better starting point. What kind of business or domain is this for?',
      mainGoal:
        'That helps. What is the main thing you want this project to achieve for your business?',
      targetUsers:
        'Got it. Who do you expect will use this most: customers, staff, admins, or another group?',
      coreFeatures:
        'Great. What are the must-have features you want in the first version?',
      platforms:
        'Makes sense. Where should this run: website, mobile app, both, or something else?',
      deliverables:
        'Good. What final deliverables would feel complete to you, like a working website, mobile app, dashboard, source code, setup help, or simply "not sure"?',
      constraintsPreferences:
        'Any preferences or constraints we should respect, like colors, style, integrations, or things you want to avoid?',
      clientBackground:
        'To guide the brief properly, what is your background here: business owner, operations, non-technical founder, technical founder, or something else?',
      suggestedTeamSize:
        'Do you already have a team size in mind, or should we suggest what fits the project?',
      experienceLevel:
        'Do you prefer a junior, mid, senior, or expert freelancer, or should we decide based on the scope?',
      experienceMinYears:
        'Do you have a minimum years-of-experience preference, or is there no preference?',
    };

    return (
      questions[nextField] ??
      'That helps. Can you share a little more detail so I can shape the brief properly?'
    );
  }
}
