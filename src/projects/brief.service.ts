import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, Repository } from 'typeorm';
import { CreateBriefMessageDto } from './dtos/create-brief-message.dto';
import { UpdateBriefDto } from './dtos/update-brief.dto';
import { BriefMessage } from './entities/brief-message.entity';
import { Brief } from './entities/brief.entity';
import { BriefDocument } from './entities/brief-document.entity';
import { Project } from './entities/project.entity';
import {
  AiService,
  type ProjectQuoteResult,
  type RequirementsDocumentExtractionResult,
} from 'src/agents/ai.service';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { assessPlanningRequirementProfile } from 'src/planning/planning-evaluation-requirements';
import {
  createProjectBudgetAllocation,
  platformFeeAllocation,
} from 'src/planning/project-budget-allocation';
import {
  getBriefScopeGaps,
  isBriefScopeFieldComplete,
  isRequirementsGuidanceRequest,
  isUncertainAnswer,
  PRICEABLE_BRIEF_FIELDS,
  removeNonAnswerItems,
  type PriceableBriefField,
} from './brief-scope-readiness';
import { BriefDocumentSecurityService } from './brief-document-security.service';
import { BriefDocumentStorageService } from './brief-document-storage.service';
import { BriefDocumentJobsService } from './brief-document-jobs.service';
import { AutomationIncidentsService } from 'src/automation/automation-incidents.service';

const RECENT_BRIEF_MESSAGE_LIMIT = 5;
const MAX_SUMMARY_LENGTH = 1000;
const MAX_BRIEF_TEXT_LENGTH = 5000;
const INITIAL_AGENT_MESSAGE_VERSION = 4;
const MAX_AI_REVISION_MESSAGES = 3;
const INITIAL_GREETING_MESSAGE =
  'The customer opened the requirements chat. Greet them warmly using the project context, acknowledge what the project seems to be about, and ask one helpful next question. Do not ask for project name, project type, budget, or deadline.';
const PROJECT_DERIVED_FIELDS = new Set(['projectType', 'budget', 'deadline']);
const USER_REQUIRED_BRIEF_FIELDS = [...PRICEABLE_BRIEF_FIELDS];
const BRIEF_CHANGE_LOCKED_PROJECT_STATUSES = new Set<ProjectStatus>([
  ProjectStatus.PLANNING_MATCHING,
  ProjectStatus.PLANNING_ASSIGNED,
  ProjectStatus.PLANNING_IN_PROGRESS,
  ProjectStatus.PLANNING_REVIEW,
  ProjectStatus.IMPLEMENTATION_READY,
  ProjectStatus.MATCHING,
  ProjectStatus.MATCHED,
  ProjectStatus.SPEC_IN_PROGRESS,
  ProjectStatus.SPEC_UNDER_REVIEW,
  ProjectStatus.SPEC_COMPLETE,
  ProjectStatus.SCOPED,
  ProjectStatus.ASSIGNED,
  ProjectStatus.ACTIVE,
  ProjectStatus.UNDER_REVIEW,
  ProjectStatus.COMPLETED,
  ProjectStatus.DISPUTED,
  ProjectStatus.CANCELLED,
]);
const BRIEF_CONFIRM_ALLOWED_LOCKED_PROJECT_STATUSES = new Set<ProjectStatus>([
  ProjectStatus.PLANNING_MATCHING,
  ProjectStatus.PLANNING_ASSIGNED,
  ProjectStatus.PLANNING_IN_PROGRESS,
  ProjectStatus.PLANNING_REVIEW,
]);

type ExtractedBriefFields = Record<string, unknown>;

@Injectable()
export class BriefService {
  constructor(
    @InjectRepository(Brief)
    private readonly briefRepo: Repository<Brief>,
    @InjectRepository(BriefMessage)
    private readonly briefMessageRepo: Repository<BriefMessage>,
    @InjectRepository(BriefDocument)
    private readonly briefDocumentRepo: Repository<BriefDocument>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly aiService: AiService,
    private readonly dataSource: DataSource,
    private readonly documentSecurity: BriefDocumentSecurityService,
    private readonly documentStorage: BriefDocumentStorageService,
    private readonly documentJobs: BriefDocumentJobsService,
    private readonly incidents: AutomationIncidentsService,
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
      order: { sequence: 'ASC' },
    });
  }

  async getDocuments(projectId: string, userId: string, isAdmin: boolean) {
    await this.findAuthorizedProject(projectId, userId, isAdmin);
    const brief = await this.getOrCreateBrief(projectId);
    const documents = await this.briefDocumentRepo.find({
      where: { briefId: brief.id },
      order: { createdAt: 'DESC' },
    });
    return documents.map((document) => this.toPublicDocument(document));
  }

  async getDocumentDownload(
    projectId: string,
    documentId: string,
    userId: string,
    isAdmin: boolean,
  ) {
    await this.findAuthorizedProject(projectId, userId, isAdmin);
    const brief = await this.getOrCreateBrief(projectId);
    const document = await this.briefDocumentRepo.findOne({
      where: { id: documentId, briefId: brief.id },
    });
    if (!document)
      throw new NotFoundException('Requirements document not found');
    return this.documentStorage.signedDownloadUrl(
      document.storagePublicId,
      document.storageFormat,
    );
  }

  async uploadDocument(
    projectId: string,
    userId: string,
    isAdmin: boolean,
    file: Express.Multer.File,
  ) {
    const project = await this.findAuthorizedProject(
      projectId,
      userId,
      isAdmin,
    );
    this.assertBriefCanChange(project);
    const brief = await this.getOrCreateBrief(projectId);
    await this.assertDocumentImportAllowed(brief.id);
    const verified = await this.documentSecurity.validateAndScan(file);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await this.briefDocumentRepo.findOne({
      where: {
        briefId: brief.id,
        sha256,
        status: In(['queued', 'processing', 'processed']),
      },
      order: { createdAt: 'DESC' },
    });
    if (duplicate) {
      return {
        document: this.toPublicDocument(duplicate),
        brief,
        duplicate: true,
        missingFields: this.getMissingFields(brief),
      };
    }
    const existingImport = await this.briefDocumentRepo.count({
      where: {
        briefId: brief.id,
        status: In(['queued', 'processing', 'processed']),
      },
    });
    if (existingImport > 0) {
      throw new ConflictException(
        'A requirements document has already started this intake. Wait for it to finish, then answer only the missing questions in chat.',
      );
    }
    await this.assertDocumentUploadRate(userId);
    const stored = await this.documentStorage.upload(
      projectId,
      verified.fileName,
      file.buffer,
    );
    let document: BriefDocument;
    try {
      document = await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `requirements-document-upload:${userId}`,
        ]);
        await this.assertDocumentUploadRate(
          userId,
          manager.getRepository(BriefDocument),
        );
        const concurrentDuplicate = await manager.findOne(BriefDocument, {
          where: {
            briefId: brief.id,
            sha256,
            status: In(['queued', 'processing', 'processed']),
          },
          order: { createdAt: 'DESC' },
        });
        if (concurrentDuplicate) return concurrentDuplicate;
        const concurrentImport = await manager.count(BriefDocument, {
          where: {
            briefId: brief.id,
            status: In(['queued', 'processing', 'processed']),
          },
        });
        if (concurrentImport > 0) {
          throw new ConflictException(
            'A requirements document has already started this intake.',
          );
        }

        const created = await manager.save(
          BriefDocument,
          manager.create(BriefDocument, {
            briefId: brief.id,
            uploadedByUserId: userId,
            fileName: verified.fileName,
            mimeType: verified.mimeType,
            sizeBytes: file.size,
            sha256,
            status: 'queued',
            scanStatus: verified.scanStatus,
            storagePublicId: stored.publicId,
            storageVersion: String(stored.version),
            storageFormat: stored.format,
            processingAttempts: 0,
            processedAt: null,
            extractedFields: null,
            summary: null,
            warnings: null,
            error: null,
          }),
        );
        await manager.save(
          BriefMessage,
          manager.create(BriefMessage, {
            briefId: brief.id,
            sequence: await this.nextMessageSequence(manager, brief.id),
            senderType: 'customer',
            message: `Uploaded requirements document: ${created.fileName}`,
            metadata: { briefDocumentId: created.id, status: 'queued' },
          }),
        );
        return created;
      });
    } catch (error) {
      await this.documentStorage.remove(stored.publicId).catch(() => undefined);
      throw error;
    }
    if (document.storagePublicId !== stored.publicId) {
      await this.documentStorage.remove(stored.publicId).catch(() => undefined);
      return {
        document: this.toPublicDocument(document),
        brief,
        duplicate: true,
        missingFields: this.getMissingFields(brief),
      };
    }

    if (this.documentJobs.enabled()) {
      try {
        await this.documentJobs.enqueue(document.id);
        return {
          document: this.toPublicDocument(document),
          brief,
          duplicate: false,
          queued: true,
          missingFields: this.getMissingFields(brief),
        };
      } catch (error) {
        // Keep it queued: the recovery scanner can safely enqueue this exact
        // document again once the queue is healthy.
        document.status = 'queued';
        document.error = this.errorMessage(error);
        await this.briefDocumentRepo.save(document);
        await this.incidents.record({
          subsystem: 'requirements_documents',
          operation: 'enqueue',
          projectId,
          errorCode: 'queue_failed',
          message: document.error,
          context: { documentId: document.id },
        });
        throw new ServiceUnavailableException(
          'The document was stored safely, but processing could not be queued. It will be retried automatically.',
        );
      }
    }
    return this.processQueuedDocument(document.id, 0, 1, file.buffer);
  }

  async processQueuedDocument(
    documentId: string,
    attemptsMade: number,
    maxAttempts: number,
    suppliedContent?: Buffer,
  ) {
    const document = await this.briefDocumentRepo.findOne({
      where: { id: documentId },
    });
    if (!document)
      throw new NotFoundException('Requirements document not found');
    if (document.status === 'processed') {
      return { document: this.toPublicDocument(document), reused: true };
    }
    document.status = 'processing';
    document.processingAttempts = Math.max(
      document.processingAttempts + 1,
      attemptsMade + 1,
    );
    document.error = null;
    await this.briefDocumentRepo.save(document);

    try {
      const content =
        suppliedContent ??
        (await this.documentStorage.download(
          document.storagePublicId,
          document.storageFormat,
          document.sizeBytes,
        ));
      const actualHash = createHash('sha256').update(content).digest('hex');
      if (actualHash !== document.sha256) {
        throw new BadRequestException(
          'Stored requirements document integrity validation failed',
        );
      }
      const brief = await this.briefRepo.findOne({
        where: { id: document.briefId },
      });
      if (!brief) throw new NotFoundException('Requirements brief not found');
      const project = await this.projectRepo.findOne({
        where: { id: brief.projectId },
      });
      if (!project) throw new NotFoundException('Project not found');
      this.assertBriefCanChange(project);
      const projectDefaultFields = this.extractProjectDefaultFields(project);
      const extraction = await this.aiService.extractRequirementsDocument({
        fileName: document.fileName,
        mimeType: document.mimeType,
        contentBase64: content.toString('base64'),
        currentBrief: this.buildCurrentBriefContext(
          brief,
          projectDefaultFields,
          this.buildProjectContext(project),
          'documentImport',
        ),
      });
      const result = await this.applyDocumentExtraction(
        document.id,
        extraction,
      );
      await this.incidents.resolveOperation(
        'requirements_documents',
        'process',
        project.id,
      );
      return result;
    } catch (error) {
      document.status = attemptsMade + 1 >= maxAttempts ? 'failed' : 'queued';
      document.error = this.errorMessage(error);
      await this.briefDocumentRepo.save(document);
      if (document.status === 'failed') {
        const brief = await this.briefRepo.findOne({
          where: { id: document.briefId },
        });
        await this.incidents.record({
          subsystem: 'requirements_documents',
          operation: 'process',
          projectId: brief?.projectId ?? null,
          errorCode: 'processing_failed',
          message: document.error,
          context: {
            documentId: document.id,
            attempts: document.processingAttempts,
          },
        });
      }
      throw error;
    }
  }

  private async applyDocumentExtraction(
    documentId: string,
    extraction: RequirementsDocumentExtractionResult,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const document = await manager
        .getRepository(BriefDocument)
        .createQueryBuilder('document')
        .setLock('pessimistic_write')
        .where('document.id = :documentId', { documentId })
        .getOne();
      if (!document) {
        throw new NotFoundException('Requirements document not found');
      }
      if (document.status === 'processed') {
        return { document: this.toPublicDocument(document), reused: true };
      }
      const brief = await manager
        .getRepository(Brief)
        .createQueryBuilder('brief')
        .setLock('pessimistic_write')
        .where('brief.id = :briefId', { briefId: document.briefId })
        .getOne();
      if (!brief) throw new NotFoundException('Requirements brief not found');
      const project = await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', { projectId: brief.projectId })
        .getOne();
      if (!project) throw new NotFoundException('Project not found');
      this.assertBriefCanChange(project);

      const existingFields = this.mergeExtractedFields(
        this.extractProjectDefaultFields(project),
        this.buildKnownFieldsFromBrief(brief),
      );
      const sanitized = this.sanitizeExtractedFields(
        extraction.extractedFields,
        '',
        null,
      );
      const missingOnly = Object.fromEntries(
        Object.entries(sanitized).filter(
          ([field]) => !this.hasFieldValue(existingFields[field]),
        ),
      );
      const extractedFields = this.mergeExtractedFields(
        existingFields,
        missingOnly,
      );
      const missingFields =
        this.getVisibleMissingFieldsFromFields(extractedFields);
      const nextQuestionField = missingFields[0] ?? null;
      const completionPercentage =
        this.getCompletionPercentageFromMissingFields(missingFields);
      const importedLabels = Object.keys(missingOnly).map((field) =>
        this.humanizeFieldName(field).toLowerCase(),
      );
      const nextQuestion = nextQuestionField
        ? this.buildNaturalFollowUpPrompt(nextQuestionField)
        : 'The first-release scope is now clear enough to review and price.';
      const warningText = extraction.warnings.length
        ? ` I also flagged: ${extraction.warnings.join(' ')}`
        : '';
      const importText = importedLabels.length
        ? `I used the document to fill ${importedLabels.join(', ')}.`
        : 'I reviewed the document, but it did not add any new confirmed requirements.';
      const agentText = this.truncate(
        `${importText} ${extraction.documentSummary}${warningText} ${nextQuestion}`,
        3000,
      );

      this.applyExtractedFieldsToBrief(brief, extractedFields, '');
      brief.isComplete = missingFields.length === 0;
      brief.completedAt =
        brief.completedAt ?? (brief.isComplete ? new Date() : null);
      this.setBriefWorkflowState(brief, {
        missingFields,
        completionPercentage,
        extractedFields,
        pendingField: nextQuestionField,
        nextQuestionField,
        extractionSource: 'requirements_document',
        aiSource: extraction.source,
        confirmedAt: null,
      });
      document.status = 'processed';
      document.processedAt = new Date();
      document.extractedFields = missingOnly;
      document.summary = extraction.documentSummary;
      document.warnings = extraction.warnings;
      document.error = null;

      const agentMessage = await manager.save(
        BriefMessage,
        manager.create(BriefMessage, {
          briefId: brief.id,
          sequence: await this.nextMessageSequence(manager, brief.id),
          senderType: 'agent',
          message: agentText,
          metadata: {
            briefDocumentId: document.id,
            extractedFields: missingOnly,
            warnings: extraction.warnings,
            nextQuestionField,
          },
        }),
      );
      const savedDocument = await manager.save(BriefDocument, document);
      const savedBrief = await manager.save(Brief, brief);
      this.invalidateUnfundedQuote(project, savedBrief.isComplete);
      await manager.save(Project, project);
      return {
        document: this.toPublicDocument(savedDocument),
        brief: savedBrief,
        agentMessage,
        duplicate: false,
        queued: false,
        missingFields,
      };
    });
  }

  private async assertDocumentUploadRate(
    userId: string,
    repository = this.briefDocumentRepo,
  ) {
    const now = Date.now();
    const perHour = this.positiveIntegerEnv(
      'REQUIREMENTS_DOCUMENT_UPLOADS_PER_HOUR',
      5,
    );
    const minimumIntervalSeconds = this.positiveIntegerEnv(
      'REQUIREMENTS_DOCUMENT_UPLOAD_MIN_INTERVAL_SECONDS',
      10,
      true,
    );
    // These are intentionally sequential: inside the advisory-lock transaction
    // they share one PostgreSQL connection, which must not execute concurrently.
    const recentCount = await repository.count({
      where: {
        uploadedByUserId: userId,
        createdAt: MoreThan(new Date(now - 60 * 60 * 1000)),
      },
    });
    const latest = await repository.findOne({
      where: { uploadedByUserId: userId },
      order: { createdAt: 'DESC' },
    });
    if (recentCount >= perHour) {
      throw new HttpException(
        `Requirements document upload limit reached (${perHour} per hour)`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (
      latest &&
      latest.createdAt.getTime() + minimumIntervalSeconds * 1000 > now
    ) {
      throw new HttpException(
        `Wait ${minimumIntervalSeconds} seconds between requirements document uploads`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private positiveIntegerEnv(
    name: string,
    fallback: number,
    allowZero = false,
  ) {
    const value = Number(process.env[name]);
    if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
      return fallback;
    }
    return value;
  }

  private toPublicDocument(document: BriefDocument) {
    return {
      id: document.id,
      briefId: document.briefId,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
      status: document.status,
      scanStatus: document.scanStatus,
      processingAttempts: document.processingAttempts,
      processedAt: document.processedAt,
      extractedFields: document.extractedFields,
      summary: document.summary,
      warnings: document.warnings,
      error: document.error,
      downloadAvailable: Boolean(document.storagePublicId),
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private errorMessage(error: unknown) {
    return error instanceof Error
      ? this.truncate(error.message, 1000)
      : 'Document extraction failed.';
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
    await this.assertNoPendingDocumentImport(brief.id);
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
    const sanitizedAiFields = this.sanitizeExtractedFields(
      aiResult.extractedFields,
      dto.content,
      this.getPendingField(brief),
    );
    const extractedFields = this.mergeExtractedFields(
      projectDefaultFields,
      this.buildKnownFieldsFromBrief(brief),
      sanitizedAiFields,
    );
    const visibleMissingFields =
      this.getVisibleMissingFieldsFromFields(extractedFields);
    const nextQuestionField = this.resolveNextQuestionField(
      aiResult.nextQuestionField,
      visibleMissingFields,
    );
    const completionPercentage =
      this.getCompletionPercentageFromMissingFields(visibleMissingFields);
    const isComplete = visibleMissingFields.length === 0;
    aiResult.missingFields = visibleMissingFields;
    aiResult.completionPercentage = completionPercentage;
    aiResult.isComplete = isComplete;
    aiResult.nextQuestionField = nextQuestionField;
    aiResult.suggestedReply = this.resolveAgentReply(
      aiResult.suggestedReply,
      aiResult.assistantReply,
      visibleMissingFields,
      recentMessages,
      dto.content,
      nextQuestionField,
      aiResult.replyMode,
    );

    const agentMessage = this.briefMessageRepo.create({
      briefId: brief.id,
      senderType: 'agent',
      message: aiResult.suggestedReply,
      metadata: aiResult,
    });

    const nextRevisionCount = wasComplete
      ? this.getRevisionCount(brief) + 1
      : this.getRevisionCount(brief);
    brief.isComplete = isComplete;
    brief.completedAt = brief.completedAt ?? (isComplete ? new Date() : null);
    this.setBriefWorkflowState(brief, {
      missingFields: visibleMissingFields,
      completionPercentage,
      extractedFields: extractedFields ?? null,
      aiRevisionOpen:
        wasComplete && nextRevisionCount < MAX_AI_REVISION_MESSAGES,
      revisionCount: nextRevisionCount,
      revisionLimit: MAX_AI_REVISION_MESSAGES,
      confirmedAt: wasComplete ? null : brief.confirmedAt,
      pendingField: nextQuestionField,
      nextQuestionField,
      extractionSource: aiResult.extractionSource ?? aiResult.source,
      aiSource: aiResult.source,
    });
    brief.aiDecided = this.buildAiDiagnostics(brief.aiDecided, aiResult);
    this.applyExtractedFieldsToBrief(brief, extractedFields, dto.content);

    const result = await this.dataSource.transaction(async (manager) => {
      // Number the pair explicitly so the customer's answer always precedes the
      // agent's reply, whatever the timestamps say. ISSUES.md #12.
      const firstSequence = await this.nextMessageSequence(manager, brief.id);
      customerMessage.sequence = firstSequence;
      agentMessage.sequence = firstSequence + 1;
      const savedCustomerMessage = await manager.save(
        BriefMessage,
        customerMessage,
      );
      const savedAgentMessage = await manager.save(BriefMessage, agentMessage);
      const updatedBrief = await manager.save(Brief, brief);

      this.invalidateUnfundedQuote(project, updatedBrief.isComplete);
      await manager.save(Project, project);

      return {
        brief: updatedBrief,
        customerMessage: savedCustomerMessage,
        agentMessage: savedAgentMessage,
        ai: aiResult,
      };
    });
    return result;
  }

  /**
   * Document import is an intake choice, not a chat attachment. Once the client
   * has sent a real chat answer, allowing a later upload would mix an arbitrary
   * document into an already-established conversation and could silently
   * replace scope decisions.
   */
  private async assertDocumentImportAllowed(briefId: string) {
    const chatStarted = await this.briefMessageRepo
      .createQueryBuilder('message')
      .where('message.brief_id = :briefId', { briefId })
      .andWhere("message.sender_type = 'customer'")
      .andWhere(
        "(message.metadata IS NULL OR NOT (message.metadata ? 'briefDocumentId'))",
      )
      .getExists();

    if (chatStarted) {
      throw new ConflictException(
        'Requirements documents can only be imported before the guided chat starts.',
      );
    }
  }

  private async assertNoPendingDocumentImport(briefId: string) {
    const pendingDocuments = await this.briefDocumentRepo.count({
      where: {
        briefId,
        status: In(['queued', 'processing']),
      },
    });
    if (pendingDocuments > 0) {
      throw new ConflictException(
        'Wait for the requirements document to finish processing before continuing in chat.',
      );
    }
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
    this.setBriefWorkflowState(brief, {
      missingFields,
      completionPercentage:
        this.getCompletionPercentageFromMissingFields(missingFields),
      extractedFields,
      aiRevisionOpen: false,
      revisionCount: this.getRevisionCount(brief),
      revisionLimit: MAX_AI_REVISION_MESSAGES,
      confirmedAt: null,
      pendingField: null,
      nextQuestionField: null,
      manuallyEditedAt: new Date(),
    });
    brief.aiDecided = this.stripWorkflowStateFromAiDecided({
      ...(brief.aiDecided ?? {}),
      manuallyEditedAt: new Date().toISOString(),
    });

    const result = await this.dataSource.transaction(async (manager) => {
      const updatedBrief = await manager.save(Brief, brief);

      this.invalidateUnfundedQuote(project, updatedBrief.isComplete);
      await manager.save(Project, project);

      return updatedBrief;
    });
    return result;
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

    this.setBriefWorkflowState(brief, {
      aiRevisionOpen: true,
      revisionCount,
      revisionLimit: MAX_AI_REVISION_MESSAGES,
      confirmedAt: null,
      reopenedAt: new Date(),
    });
    brief.aiDecided = this.stripWorkflowStateFromAiDecided(brief.aiDecided);
    const updatedBrief = await this.dataSource.transaction(async (manager) => {
      const updatedBrief = await manager.save(Brief, brief);

      await manager.save(
        BriefMessage,
        manager.create(BriefMessage, {
          briefId: brief.id,
          sequence: await this.nextMessageSequence(manager, brief.id),
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
    this.assertBriefCanConfirm(project);

    const brief = await this.getOrCreateBrief(projectId);
    const pendingDocumentCount = await this.briefDocumentRepo.count({
      where: {
        briefId: brief.id,
        status: In(['queued', 'processing']),
      },
    });
    if (pendingDocumentCount > 0) {
      throw new BadRequestException(
        'Wait for uploaded requirements documents to finish processing before confirming the brief.',
      );
    }
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

    const quoteProjectContext = this.buildProjectQuoteContext(project);
    const quoteBriefContext = this.buildBriefQuoteContext(brief, project);
    const projectQuote = await this.aiService.estimateProjectQuote({
      project: quoteProjectContext,
      brief: quoteBriefContext,
    });
    const requirementProfile = assessPlanningRequirementProfile(project, brief);

    brief.isComplete = true;
    brief.completedAt = brief.completedAt ?? new Date();
    this.setBriefWorkflowState(brief, {
      missingFields: [],
      completionPercentage: 100,
      aiRevisionOpen: false,
      revisionCount: this.getRevisionCount(brief),
      revisionLimit: MAX_AI_REVISION_MESSAGES,
      confirmedAt: new Date(),
      confirmedBy: userId,
      pendingField: null,
      nextQuestionField: null,
    });
    brief.aiDecided = this.stripWorkflowStateFromAiDecided(brief.aiDecided);

    const result = await this.dataSource.transaction(async (manager) => {
      const updatedBrief = await manager.save(Brief, brief);

      if (project.quoteStatus !== 'accepted') {
        project.quotedAmount = projectQuote.amount.toFixed(2);
        project.quotedCurrency = projectQuote.currency;
        project.quoteStatus = projectQuote.quoteStatus;
        project.quoteGeneratedAt = new Date();
        project.quoteNotes = this.buildProjectQuoteNotes(projectQuote);
        project.quoteEvidence = this.buildProjectQuoteEvidence(
          projectQuote,
          quoteProjectContext,
          quoteBriefContext,
          project.quoteGeneratedAt,
        );
        project.budgetAllocation = createProjectBudgetAllocation(
          projectQuote.amount,
          projectQuote.currency,
          requirementProfile.complexity,
          project.quoteGeneratedAt,
          Object.fromEntries(
            projectQuote.roleEstimates.map((role) => [
              role.roleKey,
              role.hourlyRate,
            ]),
          ),
          projectQuote.roleEstimates.filter(
            (
              role,
            ): role is typeof role & {
              roleKey:
                'principal_reviewer' | 'architect' | 'ui_ux' | 'implementation';
            } =>
              [
                'principal_reviewer',
                'architect',
                'ui_ux',
                'implementation',
              ].includes(role.roleKey),
          ),
        );
        project.platformFeeAmount =
          platformFeeAllocation(project.budgetAllocation)?.amount ?? '0.00';
        project.automationStatus =
          projectQuote.quoteStatus === 'out_of_budget'
            ? 'budget_revision_required'
            : 'awaiting_funding';
      } else if (!project.budgetAllocation && project.quotedAmount) {
        project.budgetAllocation = createProjectBudgetAllocation(
          project.quotedAmount,
          project.quotedCurrency ?? project.currency,
          requirementProfile.complexity,
          project.quoteGeneratedAt ?? new Date(),
        );
        project.platformFeeAmount =
          platformFeeAllocation(project.budgetAllocation)?.amount ?? '0.00';
      }

      if (this.shouldMarkBriefComplete(project)) {
        project.status = ProjectStatus.BRIEF_COMPLETE;
      }

      await manager.save(Project, project);

      return updatedBrief;
    });
    return result;
  }

  private resolveAgentReply(
    suggestedReply: string,
    assistantReply: string | null | undefined,
    missingFields: string[],
    recentMessages: Array<{ senderType: string; content: string }>,
    latestMessage: string,
    nextQuestionField: string | null,
    replyMode?: string | null,
  ) {
    // Completion is owned by validated server state, not by the model's prose.
    // A model can otherwise append another question after extracting the final
    // fields, leaving the UI looking like an endless interview even though the
    // brief is already complete.
    if (missingFields.length === 0) {
      return 'Thanks—the first-release scope is complete. Review the brief, then confirm it to generate your quote.';
    }

    const lastAgentMessage = [...recentMessages]
      .reverse()
      .find((message) => message.senderType === 'agent');

    const guidanceField = nextQuestionField
      ? this.resolveGuidanceField(latestMessage, nextQuestionField)
      : null;
    if (
      guidanceField &&
      nextQuestionField &&
      missingFields.includes(nextQuestionField)
    ) {
      return this.buildAdviceReply(guidanceField);
    }

    // The requirements graph owns progression and explicitly labels its response.
    // Accept that stateful response without requiring brittle English marker matches.
    if (
      replyMode &&
      assistantReply?.trim() &&
      !this.looksLikePrematureCompletionReply(assistantReply, missingFields) &&
      (!lastAgentMessage ||
        this.normalizeComparableText(lastAgentMessage.content) !==
          this.normalizeComparableText(assistantReply))
    ) {
      return assistantReply;
    }

    // A model reply is only usable if it asks about the field the state machine
    // is actually waiting on. Without this the chat ran one question behind:
    // the customer was shown the question for the step just completed, answered
    // it, and saw no progress because the answer was credited elsewhere.
    // See ISSUES.md #16 (and #14, which is the same defect).
    if (
      assistantReply &&
      !this.looksLikePrematureCompletionReply(assistantReply, missingFields) &&
      !this.looksLikeAnsweredFieldQuestion(assistantReply, missingFields) &&
      this.replyTargetsField(assistantReply, nextQuestionField) &&
      (!lastAgentMessage ||
        this.normalizeComparableText(lastAgentMessage.content) !==
          this.normalizeComparableText(assistantReply))
    ) {
      return assistantReply;
    }

    // Ask about the pending field, not simply the first missing one.
    const fallbackPrompt = this.buildNaturalFollowUpPrompt(
      nextQuestionField ?? missingFields[0],
    );

    if (
      suggestedReply &&
      !this.looksLikeAnsweredFieldQuestion(suggestedReply, missingFields) &&
      this.replyTargetsField(suggestedReply, nextQuestionField) &&
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

  private looksLikePrematureCompletionReply(
    reply: string,
    missingFields: string[],
  ) {
    if (missingFields.length === 0) return false;

    const normalized = this.normalizeComparableText(reply);
    return [
      'brief is complete',
      'requirements are complete',
      'all requirements captured',
      'enough detail to continue',
      'ready to continue',
      'ready for the next step',
      'we have everything',
      'have everything',
    ].some((phrase) => normalized.includes(phrase));
  }

  /**
   * Phrases that identify which brief field a question is asking about. Used
   * both to spot a question about an already-answered field and to confirm a
   * reply actually asks about the field the state machine is waiting on.
   */
  private static readonly QUESTION_MARKERS_BY_FIELD: Record<string, string[]> =
    {
      businessDomain: ['what kind of business', 'what domain'],
      mainGoal: ['main outcome', 'main thing', 'want this project to achieve'],
      targetUsers: ['who will use', 'who do you expect will use'],
      coreFeatures: ['must-have features', 'core features'],
      platforms: [
        'where should this run',
        'website, mobile app',
        'web and mobile',
      ],
      solutionType: ['single landing page', 'multi-page website', 'actual ios'],
      scopeDetails: ['page or screen count', 'main user journey'],
      integrations: ['connect to payments', 'external systems', 'integrations'],
      adminNeeds: ['private admin area', 'admin dashboard'],
      deliverables: ['final deliverables', 'what final things', 'handed over'],
      constraintsPreferences: [
        'preferences or constraints',
        'constraints we should',
      ],
      clientBackground: ['your background', 'what is your background'],
      suggestedTeamSize: ['team size'],
      experienceLevel: ['junior, mid, senior', 'experience level'],
      experienceMinYears: ['minimum years', 'years-of-experience'],
    };

  private looksLikeAnsweredFieldQuestion(
    reply: string,
    missingFields: string[],
  ) {
    const normalized = this.normalizeComparableText(reply);
    const missing = new Set(missingFields);
    return Object.entries(BriefService.QUESTION_MARKERS_BY_FIELD).some(
      ([field, markers]) => {
        if (missing.has(field)) return false;
        return markers.some((marker) => normalized.includes(marker));
      },
    );
  }

  /**
   * True when the reply asks about `field`. The model writes its reply from the
   * conversation so far and would routinely ask about the step it had just
   * completed, one behind `next_question_field` — the customer saw a stale
   * question, answered it, and the answer was credited to a different field.
   * See ISSUES.md #16.
   */
  private replyTargetsField(reply: string, field: string | null) {
    if (!field) return true;
    const markers = BriefService.QUESTION_MARKERS_BY_FIELD[field];
    if (!markers?.length) return true;
    const normalized = this.normalizeComparableText(reply);
    return markers.some((marker) => normalized.includes(marker));
  }

  private resolveNextQuestionField(
    modelField: string | null | undefined,
    missingFields: string[],
  ) {
    if (modelField && missingFields.includes(modelField)) {
      return modelField;
    }

    return missingFields[0] ?? null;
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
      order: { sequence: 'ASC' },
    });

    if (firstAgentMessage) {
      if (
        firstAgentMessage.metadata?.systemPrompt === true &&
        firstAgentMessage.metadata?.initialAgentMessageVersion !==
          INITIAL_AGENT_MESSAGE_VERSION
      ) {
        const customerHasReplied = await this.briefMessageRepo.exists({
          where: { briefId: brief.id, senderType: 'customer' },
        });
        // Refresh unopened chats to the new requirements experience, but never
        // rewrite conversation history after a customer has replied.
        if (!customerHasReplied) {
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
      const sanitizedAiFields = this.sanitizeExtractedFields(
        aiResult.extractedFields,
        INITIAL_GREETING_MESSAGE,
        this.getPendingField(brief),
      );
      const extractedFields = this.mergeExtractedFields(
        projectDefaultFields,
        this.buildKnownFieldsFromBrief(brief),
        sanitizedAiFields,
      );
      const missingFields =
        this.getVisibleMissingFieldsFromFields(extractedFields);
      const nextQuestionField = this.resolveNextQuestionField(
        aiResult.nextQuestionField,
        missingFields,
      );
      const completionPercentage =
        this.getCompletionPercentageFromMissingFields(missingFields);
      aiResult.missingFields = missingFields;
      aiResult.completionPercentage = completionPercentage;
      aiResult.isComplete = missingFields.length === 0;
      aiResult.nextQuestionField = nextQuestionField;

      this.setBriefWorkflowState(brief, {
        missingFields,
        completionPercentage,
        extractedFields: extractedFields ?? null,
        pendingField: nextQuestionField,
        nextQuestionField,
        extractionSource: aiResult.extractionSource ?? aiResult.source,
        aiSource: aiResult.source,
      });
      brief.aiDecided = this.buildAiDiagnostics(brief.aiDecided, aiResult);
      this.applyExtractedFieldsToBrief(brief, extractedFields, '');
      await this.briefRepo.save(brief);

      return this.resolveAgentReply(
        aiResult.suggestedReply,
        aiResult.assistantReply,
        missingFields,
        [],
        INITIAL_GREETING_MESSAGE,
        nextQuestionField,
        aiResult.replyMode,
      );
    } catch {
      return this.buildInitialFallbackMessage(project);
    }
  }

  private async getRecentMessages(briefId: string) {
    const messages = await this.briefMessageRepo.find({
      where: { briefId },
      order: { sequence: 'DESC' },
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
    const aiRevisionOpen = this.getAiRevisionOpen(brief);

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
    if (
      project.quoteStatus === 'accepted' ||
      Number(project.heldAmount ?? 0) > 0
    ) {
      throw new BadRequestException(
        'The funded project brief is locked. Record a scoped change request and review its budget and deadline impact before changing requirements.',
      );
    }

    if (BRIEF_CHANGE_LOCKED_PROJECT_STATUSES.has(project.status)) {
      throw new BadRequestException(
        'The brief cannot be changed after the project is assigned or closed.',
      );
    }
  }

  private assertBriefCanConfirm(project: Project) {
    if (
      project.quoteStatus === 'accepted' ||
      Number(project.heldAmount ?? 0) > 0
    ) {
      throw new BadRequestException(
        'The funded project brief is already confirmed. Use a scoped change request for later requirement changes.',
      );
    }

    if (BRIEF_CONFIRM_ALLOWED_LOCKED_PROJECT_STATUSES.has(project.status)) {
      return;
    }
    this.assertBriefCanChange(project);
  }

  private shouldMarkBriefComplete(project: Project) {
    return [ProjectStatus.DRAFT, ProjectStatus.IN_PROGRESS].includes(
      project.status,
    );
  }

  private invalidateUnfundedQuote(project: Project, briefComplete: boolean) {
    if (
      project.quoteStatus === 'accepted' ||
      Number(project.heldAmount ?? 0) > 0
    ) {
      return;
    }

    project.quotedAmount = null;
    project.quotedCurrency = null;
    project.quoteStatus = 'not_ready';
    project.quoteGeneratedAt = null;
    project.quoteNotes = briefComplete
      ? 'Confirm the updated requirements to generate a scope-based quote.'
      : 'More scope detail is required before a reliable quote can be generated.';
    project.budgetAllocation = null;
    project.quoteEvidence = null;
    project.platformFeeAmount = '0.00';
    project.automationStatus = briefComplete
      ? 'awaiting_quote'
      : 'awaiting_requirements';

    if (briefComplete) {
      if (
        [ProjectStatus.DRAFT, ProjectStatus.IN_PROGRESS].includes(
          project.status,
        )
      ) {
        project.status = ProjectStatus.BRIEF_COMPLETE;
      }
    } else if (project.status === ProjectStatus.BRIEF_COMPLETE) {
      project.status = ProjectStatus.IN_PROGRESS;
    }
  }

  private extractProjectDefaultFields(project: Project): ExtractedBriefFields {
    const fields: ExtractedBriefFields = {};
    const budget = this.formatProjectBudget(project);

    // projectType is a classification of the work ("multi-page web application"),
    // not the project's name. Seeding it from the title made every brief in the
    // database carry its own title here, which is useless to pricing and
    // matching. It is derived from solutionType once known instead.
    // See ISSUES.md #15.
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

  private buildProjectQuoteContext(project: Project) {
    return {
      id: project.id,
      title: project.title,
      name: project.title,
      description: project.description,
      status: project.status,
      budgetMin: this.toDecimalNumber(project.budgetMin),
      budgetMax: this.toDecimalNumber(project.budgetMax),
      currency: project.currency,
      deadline: project.deadline?.toISOString() ?? null,
      isDeadlineFlexible: project.isDeadlineFlexible,
    };
  }

  private buildBriefQuoteContext(brief: Brief, project: Project) {
    const knownFields = this.buildKnownFieldsFromBrief(brief) ?? {};
    const requirementProfile = assessPlanningRequirementProfile(project, brief);

    return this.cleanJsonSection({
      ...knownFields,
      summary: brief.summary,
      briefText: brief.briefText,
      businessDomain: brief.domain ?? knownFields.businessDomain,
      projectType: brief.projectType ?? knownFields.projectType,
      mainGoal: brief.mainGoal ?? knownFields.mainGoal,
      targetUsers: brief.targetUsers ?? knownFields.targetUsers,
      coreFeatures: requirementProfile.features,
      requirementProfile,
      platforms: brief.platforms ?? knownFields.platforms,
      solutionType: knownFields.solutionType,
      scopeDetails: knownFields.scopeDetails,
      integrations: knownFields.integrations,
      adminNeeds: knownFields.adminNeeds,
      deliverables: brief.deliverablesText ?? knownFields.deliverables,
      constraintsPreferences:
        brief.constraintsPreferences ?? knownFields.constraintsPreferences,
      clientBackground: brief.clientBackground ?? knownFields.clientBackground,
      suggestedTeamSize:
        brief.suggestedTeamSize ?? knownFields.suggestedTeamSize,
      experienceLevel: brief.experienceLevel ?? knownFields.experienceLevel,
      experienceMinYears:
        brief.experienceMinYears ?? knownFields.experienceMinYears,
      requiredSkills: brief.requiredSkills,
      preferredSkills: brief.preferredSkills,
      acceptanceCriteria: brief.acceptanceCriteria,
    });
  }

  private buildProjectQuoteNotes(quote: ProjectQuoteResult) {
    const sections = [
      quote.rationale,
      `Recommended minimum: ${quote.recommendedMinimum.toFixed(2)} ${quote.currency}. Budget gap: ${quote.budgetGap.toFixed(2)} ${quote.currency}.`,
      quote.roleEstimates.length
        ? `Team cost assumptions: ${quote.roleEstimates.map((role) => `${role.people} ${role.roleKey} × ${role.hoursEach}h × ${role.hourlyRate.toFixed(2)} ${quote.currency}`).join('; ')}.`
        : null,
      quote.assumptions.length
        ? `Assumptions: ${quote.assumptions.join(' ')}`
        : null,
      quote.pricingSignals.length
        ? `Pricing signals: ${quote.pricingSignals.join(' ')}`
        : null,
      quote.sources.length ? `Sources: ${quote.sources.join(', ')}` : null,
      `Confidence: ${Math.round(quote.confidence * 100)}%. Complexity: ${quote.complexity}.`,
    ];

    return this.truncate(sections.filter(Boolean).join('\n\n'), 4000);
  }

  private buildProjectQuoteEvidence(
    quote: ProjectQuoteResult,
    project: Record<string, unknown>,
    brief: Record<string, unknown>,
    generatedAt: Date,
  ) {
    const scopeInputs = this.cleanJsonSection({
      projectType: brief.projectType,
      businessDomain: brief.businessDomain,
      mainGoal: brief.mainGoal,
      targetUsers: brief.targetUsers,
      coreFeatures: brief.coreFeatures,
      platforms: brief.platforms,
      solutionType: brief.solutionType,
      scopeDetails: brief.scopeDetails,
      integrations: brief.integrations,
      adminNeeds: brief.adminNeeds,
      deliverables: brief.deliverables,
      suggestedTeamSize: brief.suggestedTeamSize,
      requirementProfile: brief.requirementProfile,
      deadline: project.deadline,
      isDeadlineFlexible: project.isDeadlineFlexible,
    });
    const scopeHash = createHash('sha256')
      .update(JSON.stringify(scopeInputs))
      .digest('hex');
    const sourceSnapshots = quote.sources.map((source) => {
      let domain: string | null = null;
      try {
        domain = new URL(source).hostname;
      } catch {
        domain = null;
      }
      return {
        reference: source,
        domain,
        capturedAt: generatedAt.toISOString(),
        evidenceType: domain ? 'marketplace_reference' : 'internal_reference',
      };
    });
    return {
      schemaVersion: 1,
      estimatorVersion: 'scope-tiered-fixed-price-v2',
      generatedAt: generatedAt.toISOString(),
      source: quote.source,
      currency: quote.currency,
      amount: quote.amount,
      recommendedMinimum: quote.recommendedMinimum,
      budgetGap: quote.budgetGap,
      confidence: quote.confidence,
      complexity: quote.complexity,
      scopeHash,
      scopeInputs,
      roleEstimates: quote.roleEstimates,
      assumptions: quote.assumptions,
      pricingSignals: quote.pricingSignals,
      sources: sourceSnapshots,
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

  private sanitizeExtractedFields(
    fields: ExtractedBriefFields | undefined,
    latestMessage: string,
    pendingField: string | null,
  ): ExtractedBriefFields {
    const sanitized: ExtractedBriefFields = {};
    const guidanceRequest = isRequirementsGuidanceRequest(latestMessage);

    for (const [field, value] of Object.entries(fields ?? {})) {
      const cleanedValue = removeNonAnswerItems(value);
      if (!this.hasFieldValue(cleanedValue)) continue;
      if (
        USER_REQUIRED_BRIEF_FIELDS.includes(field as PriceableBriefField) &&
        !isBriefScopeFieldComplete(field as PriceableBriefField, cleanedValue)
      ) {
        continue;
      }
      sanitized[field] = cleanedValue;
    }

    const normalizedMessage = this.normalizeComparableText(latestMessage);
    const websiteOnly =
      /\b(?:mobile[- ]friendly|responsive|mobile)\s+web(?:site)?\b/.test(
        normalizedMessage,
      );
    const explicitMobileApp =
      /\b(?:mobile|native|ios|android)\s+app\b|\bflutter\b|\breact native\b|\bapp store\b|\bplay store\b/.test(
        normalizedMessage,
      );
    if (websiteOnly && !explicitMobileApp) {
      sanitized.platforms = ['website'];
    }

    if (
      !guidanceRequest &&
      pendingField &&
      !this.hasFieldValue(sanitized[pendingField])
    ) {
      const deterministicValue = this.extractPendingFieldAnswer(
        pendingField,
        latestMessage,
      );
      if (
        deterministicValue !== null &&
        (!USER_REQUIRED_BRIEF_FIELDS.includes(
          pendingField as PriceableBriefField,
        ) ||
          isBriefScopeFieldComplete(
            pendingField as PriceableBriefField,
            deterministicValue,
          ))
      ) {
        sanitized[pendingField] = deterministicValue;
      }
    }

    return sanitized;
  }

  private extractPendingFieldAnswer(
    pendingField: string,
    latestMessage: string,
  ): string | string[] | number | null {
    const normalized = this.normalizeComparableText(latestMessage);

    if (pendingField === 'platforms') {
      const platforms = new Set<string>();

      const websiteOnly =
        /\b(?:mobile[- ]friendly|responsive|mobile)\s+web(?:site)?\b/.test(
          normalized,
        );
      const explicitMobileApp =
        /\b(?:mobile|native|ios|android)\s+app\b|\bflutter\b|\breact native\b|\bapp store\b|\bplay store\b/.test(
          normalized,
        );

      if (websiteOnly && !explicitMobileApp) return ['website'];

      if (
        /\bboth\b/.test(normalized) ||
        /\bweb(site)?\b/.test(normalized) ||
        /\bmobile\b/.test(normalized) ||
        /\bapp\b/.test(normalized)
      ) {
        if (/\bboth\b/.test(normalized) || /\bweb(site)?\b/.test(normalized)) {
          platforms.add('website');
        }
        if (
          /\bboth\b/.test(normalized) ||
          /\bmobile\b|\bapp\b/.test(normalized)
        ) {
          platforms.add('mobile app');
        }
      }

      return platforms.size > 0 ? Array.from(platforms) : null;
    }

    if (
      [
        'businessDomain',
        'mainGoal',
        'targetUsers',
        'coreFeatures',
        'solutionType',
        'scopeDetails',
        'integrations',
        'adminNeeds',
        'deliverables',
        'constraintsPreferences',
        'clientBackground',
      ].includes(pendingField)
    ) {
      return this.toTextValue(latestMessage);
    }

    if (pendingField === 'suggestedTeamSize') {
      return this.toPositiveInteger(latestMessage);
    }

    if (pendingField === 'experienceLevel') {
      return this.normalizeExperienceLevel(
        this.toSingleLineText(latestMessage, 40),
      );
    }

    if (pendingField === 'experienceMinYears') {
      return this.toPositiveInteger(latestMessage);
    }

    return null;
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
    const pendingField = this.getPendingField(brief);

    return {
      id: brief.id,
      projectId: brief.projectId,
      knownFields: Object.keys(knownFields).length > 0 ? knownFields : null,
      projectContext: projectContext ?? null,
      conversationMode: conversationMode ?? null,
      pendingField,
      missingFields: this.getMissingFields(brief),
      completionPercentage: this.getCompletionPercentage(brief),
      aiRevisionOpen: this.getAiRevisionOpen(brief),
      revisionCount: this.getRevisionCount(brief),
      revisionLimit: this.getRevisionLimit(brief),
      confirmedAt: brief.confirmedAt?.toISOString() ?? null,
      confirmedBy: brief.confirmedBy,
      isComplete: brief.isComplete,
      completedAt: brief.completedAt?.toISOString() ?? null,
      summary: brief.summary,
      projectType: brief.projectType,
      domain: brief.domain,
      mainGoal: brief.mainGoal,
      targetUsers: brief.targetUsers,
      coreFeatures: brief.coreFeatures,
      platforms: brief.platforms,
      budget: brief.budget,
      deadline: brief.deadlineText,
      deliverablesText: brief.deliverablesText,
      constraintsPreferences: brief.constraintsPreferences,
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

    const projectType = this.toSingleLineText(
      fields.projectType ?? fields.solutionType,
      100,
    );
    if (projectType) brief.projectType = projectType;

    const domain = this.toSingleLineText(fields.businessDomain, 100);
    if (domain) brief.domain = domain;

    const mainGoal = this.toTextValue(fields.mainGoal);
    if (mainGoal) brief.mainGoal = this.truncate(mainGoal, 1000);

    const targetUsers = this.toStringList(fields.targetUsers).join(', ');
    if (targetUsers) brief.targetUsers = this.truncate(targetUsers, 1000);

    const coreFeatures = this.toStringList(fields.coreFeatures).join(', ');
    if (coreFeatures) brief.coreFeatures = this.truncate(coreFeatures, 1500);

    const platforms = this.toStringList(fields.platforms).join(', ');
    if (platforms) brief.platforms = this.truncate(platforms, 500);

    const budget = this.toTextValue(fields.budget);
    if (budget) brief.budget = this.truncate(budget, 500);

    const deadline = this.toTextValue(fields.deadline);
    if (deadline) brief.deadlineText = this.truncate(deadline, 500);

    const deliverablesText = this.toStringList(fields.deliverables).join(', ');
    if (deliverablesText) {
      brief.deliverablesText = this.truncate(deliverablesText, 1000);
    }

    const constraintsPreferences = this.toStringList(
      fields.constraintsPreferences,
    ).join(', ');
    if (constraintsPreferences) {
      brief.constraintsPreferences = this.truncate(
        constraintsPreferences,
        1000,
      );
    }

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

    // `technical` is for technical requirements only. It used to receive every
    // answer, including mainGoal, targetUsers, coreFeatures and platforms —
    // which already have their own columns and are the source of truth. Anything
    // reading "technical requirements" got the whole interview instead.
    // Reads still fall back to the old keys for briefs written before this.
    // See ISSUES.md #17.
    brief.technical = this.mergeJsonSection(brief.technical, {
      solutionType: this.toTextValue(fields.solutionType),
      scopeDetails: this.toTextValue(fields.scopeDetails),
      integrations: this.toStringList(fields.integrations),
      adminNeeds: this.toTextValue(fields.adminNeeds),
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
      mainGoal: brief.mainGoal ?? technical.mainGoal,
      targetUsers: brief.targetUsers ?? technical.targetUsers,
      coreFeatures: brief.coreFeatures ?? technical.coreFeatures,
      platforms: brief.platforms ?? technical.platforms,
      solutionType: technical.solutionType,
      scopeDetails: technical.scopeDetails,
      integrations: technical.integrations,
      adminNeeds: technical.adminNeeds,
      budget: brief.budget ?? nonFunctional.budget,
      deadline: brief.deadlineText ?? nonFunctional.deadline,
      constraintsPreferences:
        brief.constraintsPreferences ?? nonFunctional.constraintsPreferences,
      deliverables: brief.deliverablesText ?? deliverables.items,
    });

    return Object.keys(knownFields).length > 0 ? knownFields : null;
  }

  private getStoredExtractedFields(
    brief: Brief,
  ): ExtractedBriefFields | undefined {
    const stored = this.asPlainObject(brief.extractedFields);
    if (stored && Object.keys(stored).length > 0) return stored;

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
    const solutionType = this.toTextValue(fields.solutionType);
    const scopeDetails = this.toTextValue(fields.scopeDetails);

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
    if (solutionType) parts.push(`Solution: ${solutionType}`);
    if (scopeDetails) parts.push(`Scope: ${scopeDetails}`);

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
      ['Solution type', this.toTextValue(fields.solutionType)],
      ['Scope details', this.toTextValue(fields.scopeDetails)],
      ['Integrations', this.toStringList(fields.integrations).join(', ')],
      ['Admin needs', this.toTextValue(fields.adminNeeds)],
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

    // Do not split on the word "and": it appears inside legitimate feature
    // names, and splitting there turned the customer's "search by title and
    // author" into two features, one of them literally called "author".
    // "Login and registration", "drag and drop upload" and "terms and
    // conditions" break the same way. Commas, semicolons and newlines are
    // genuine list separators; "and" is not. See ISSUES.md #28.
    return text
      .split(/[,;\n]/g)
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

  private toDecimalNumber(value: unknown): number | null {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed)
      ? parsed
      : null;
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

  private setBriefWorkflowState(
    brief: Brief,
    state: {
      missingFields?: string[];
      completionPercentage?: number;
      extractedFields?: ExtractedBriefFields | null;
      aiRevisionOpen?: boolean;
      revisionCount?: number;
      revisionLimit?: number;
      confirmedAt?: Date | null;
      confirmedBy?: string | null;
      manuallyEditedAt?: Date | null;
      reopenedAt?: Date | null;
      pendingField?: string | null;
      nextQuestionField?: string | null;
      extractionSource?: string | null;
      aiSource?: string | null;
    },
  ) {
    if (state.missingFields !== undefined) {
      brief.missingFields = state.missingFields;
    }
    if (state.completionPercentage !== undefined) {
      brief.completionPercentage = Math.min(
        100,
        Math.max(0, Math.round(state.completionPercentage)),
      );
    }
    if (state.extractedFields !== undefined) {
      brief.extractedFields = state.extractedFields;
    }
    if (state.aiRevisionOpen !== undefined) {
      brief.aiRevisionOpen = state.aiRevisionOpen;
    }
    if (state.revisionCount !== undefined) {
      brief.revisionCount = state.revisionCount;
    }
    if (state.revisionLimit !== undefined) {
      brief.revisionLimit = state.revisionLimit;
    }
    if (state.confirmedAt !== undefined) {
      brief.confirmedAt = state.confirmedAt;
    }
    if (state.confirmedBy !== undefined) {
      brief.confirmedBy = state.confirmedBy;
    }
    if (state.manuallyEditedAt !== undefined) {
      brief.manuallyEditedAt = state.manuallyEditedAt;
    }
    if (state.reopenedAt !== undefined) {
      brief.reopenedAt = state.reopenedAt;
    }
    if (state.pendingField !== undefined) {
      brief.pendingField = state.pendingField;
    }
    if (state.nextQuestionField !== undefined) {
      brief.nextQuestionField = state.nextQuestionField;
    }
    if (state.extractionSource !== undefined) {
      brief.extractionSource = state.extractionSource;
    }
    if (state.aiSource !== undefined) {
      brief.aiSource = state.aiSource;
    }
  }

  private buildAiDiagnostics(
    current: Record<string, unknown> | null,
    aiResult: {
      fastPathUsed?: boolean;
      fastPathReason?: string | null;
    },
  ) {
    const diagnostics = this.stripWorkflowStateFromAiDecided(current) ?? {};

    diagnostics.fastPathUsed = aiResult.fastPathUsed ?? false;
    diagnostics.fastPathReason = aiResult.fastPathReason ?? null;

    return Object.keys(diagnostics).length > 0 ? diagnostics : null;
  }

  private stripWorkflowStateFromAiDecided(
    current: Record<string, unknown> | null,
  ) {
    const source = this.asPlainObject(current);
    if (!source) return null;

    const rest = { ...source };
    for (const key of [
      'missingFields',
      'completionPercentage',
      'extractedFields',
      'aiRevisionOpen',
      'revisionCount',
      'revisionLimit',
      'confirmedAt',
      'confirmedBy',
      'manuallyEditedAt',
      'reopenedAt',
      'pendingField',
      'nextQuestionField',
      'extractionSource',
      'source',
    ]) {
      delete rest[key];
    }

    return Object.keys(rest).length > 0 ? rest : null;
  }

  private truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }

  private removeProjectDerivedMissingFields(missingFields: string[]) {
    return missingFields.filter((field) => !PROJECT_DERIVED_FIELDS.has(field));
  }

  private getVisibleMissingFieldsFromFields(fields: ExtractedBriefFields) {
    return getBriefScopeGaps(fields);
  }

  private getCompletionPercentageFromMissingFields(missingFields: string[]) {
    const completedFields =
      USER_REQUIRED_BRIEF_FIELDS.length - missingFields.length;
    return Math.round(
      (completedFields / USER_REQUIRED_BRIEF_FIELDS.length) * 100,
    );
  }

  /**
   * Next per-brief message number. Ordering by `created_at` alone was ambiguous
   * because a customer answer and the agent reply share a timestamp — the pair
   * could render in either order. See ISSUES.md #12.
   */
  private async nextMessageSequence(
    manager: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    briefId: string,
  ): Promise<number> {
    const rows = (await manager.query(
      `SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM brief_messages WHERE brief_id = $1`,
      [briefId],
    )) as Array<{ next: string | number }>;
    return Number(rows?.[0]?.next ?? 1);
  }

  private getRevisionCount(brief: Brief) {
    if (
      typeof brief.revisionCount === 'number' &&
      Number.isFinite(brief.revisionCount)
    ) {
      return brief.revisionCount;
    }

    const aiDecided = this.asPlainObject(brief.aiDecided);
    const revisionCount = aiDecided?.revisionCount;

    return typeof revisionCount === 'number' && Number.isFinite(revisionCount)
      ? revisionCount
      : 0;
  }

  private getRevisionLimit(brief: Brief) {
    if (
      typeof brief.revisionLimit === 'number' &&
      Number.isFinite(brief.revisionLimit)
    ) {
      return brief.revisionLimit;
    }

    const aiDecided = this.asPlainObject(brief.aiDecided);
    const revisionLimit = aiDecided?.revisionLimit;

    return typeof revisionLimit === 'number' && Number.isFinite(revisionLimit)
      ? revisionLimit
      : MAX_AI_REVISION_MESSAGES;
  }

  private getAiRevisionOpen(brief: Brief) {
    if (typeof brief.aiRevisionOpen === 'boolean') return brief.aiRevisionOpen;
    return this.asPlainObject(brief.aiDecided)?.aiRevisionOpen === true;
  }

  private getPendingField(brief: Brief) {
    if (brief.pendingField) return brief.pendingField;
    const pendingField = this.asPlainObject(brief.aiDecided)?.pendingField;
    return typeof pendingField === 'string' ? pendingField : null;
  }

  private getMissingFields(brief: Brief) {
    if (Array.isArray(brief.missingFields)) return brief.missingFields;

    const missingFields = this.asPlainObject(brief.aiDecided)?.missingFields;
    return Array.isArray(missingFields)
      ? missingFields
          .map((field) => this.toSingleLineText(field, 80))
          .filter((field): field is string => Boolean(field))
      : [];
  }

  private getCompletionPercentage(brief: Brief) {
    if (
      typeof brief.completionPercentage === 'number' &&
      Number.isFinite(brief.completionPercentage)
    ) {
      return brief.completionPercentage;
    }

    const completionPercentage = this.asPlainObject(
      brief.aiDecided,
    )?.completionPercentage;
    return typeof completionPercentage === 'number' &&
      Number.isFinite(completionPercentage)
      ? completionPercentage
      : 0;
  }

  private extractManualUpdateFields(dto: UpdateBriefDto): ExtractedBriefFields {
    return this.cleanJsonSection({
      businessDomain: dto.businessDomain,
      mainGoal: dto.mainGoal,
      targetUsers: dto.targetUsers,
      coreFeatures: dto.coreFeatures,
      platforms: dto.platforms,
      solutionType: dto.solutionType,
      scopeDetails: dto.scopeDetails,
      integrations: dto.integrations,
      adminNeeds: dto.adminNeeds,
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
      solutionType:
        'To price this correctly, is this a single landing page, a multi-page website, a web application, or an actual iOS/Android mobile app? A mobile-friendly website still counts as a website.',
      scopeDetails:
        'What should the first version contain? A rough page or screen count and the main user journey are enough.',
      integrations:
        'Does it connect to payments, maps, email or SMS, social login, analytics, or another system? You can simply say "none".',
      adminNeeds:
        'Will your team need a private admin area to manage content, users, orders, or reports? If not, say "no admin dashboard".',
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

  private buildAdviceReply(nextField: string) {
    const replies: Record<string, string> = {
      mainGoal:
        'No problem. The goal is the business result, not the technology. Common choices are getting leads, selling online, reducing manual work, or helping customers self-serve. Which result matters most for this first version?',
      targetUsers:
        'No problem. Think about the people who will actually use it: customers, staff, admins, or a specific group. Who completes the main action in the first version?',
      coreFeatures:
        'No problem. Features are the actions the product must support. For a small website that might be reading key information and sending an enquiry; for an app it could include accounts, booking, or checkout. What is the single most important action a user must complete?',
      deliverables:
        'No problem. For this project, I’d usually suggest a working website or app, an admin dashboard if you need to manage orders or stock, payment setup, deployment, and a short handover guide so you can run it without technical help. Does that feel right, or would you remove anything?',
      suggestedTeamSize:
        'Totally fine. For a first version, I’d usually keep the team lean: one UI/UX designer, one architect or senior backend/full-stack person, and one or two implementation freelancers depending on scope. Should I note a small team, or do you want a bigger team for faster delivery?',
      experienceLevel:
        'A rough preference is enough. For payments, dashboards, and customer-facing flows, I’d lean mid-to-senior so the project is reliable without overpaying for every task. Does mid-to-senior sound right?',
      experienceMinYears:
        'You do not need to know this exactly. For a project like this, I’d usually set the minimum around 3 years for core implementation, with stronger senior review for architecture and payments. Should I use 3 years, or keep it open and match by skill scores?',
      platforms:
        'If customers need to order easily, I’d usually start with a responsive website first, then add a mobile app if repeat ordering is important. If you already want both, I can capture website and mobile app. Which direction feels right?',
      solutionType:
        'To avoid overpricing, I recommend choosing the smallest product shape that meets the goal. A landing page suits presentation or lead collection; a web app suits accounts and workflows; a mobile app is separate iOS/Android software. Which one describes the first release?',
      scopeDetails:
        'A rough estimate is enough. Tell me approximately how many pages or screens you imagine and the main path a user follows from opening the product to completing their goal.',
      integrations:
        'If you are unsure, start with none unless the first release must take payments, use maps, send SMS/email, support social login, or connect to an existing system. Which of those are essential?',
      adminNeeds:
        'An admin dashboard is useful only if your team must regularly manage content, users, orders, or reports. Should the first version include that, or can those updates be handled manually?',
    };

    return (
      replies[nextField] ??
      'No problem. I can help you choose. Tell me what matters most here: speed, budget, quality, or ease of use, and I’ll suggest the best option for this project.'
    );
  }

  private resolveGuidanceField(
    latestMessage: string,
    pendingField: string,
  ): string | null {
    const normalized = this.normalizeComparableText(latestMessage);
    const markersByField: Record<string, string[]> = {
      mainGoal: ['goal', 'outcome', 'business result'],
      targetUsers: ['target user', 'audience', 'who will use'],
      coreFeatures: ['feature', 'functionality', 'must have'],
      platforms: ['platform', 'website or app', 'web or mobile'],
      solutionType: ['solution type', 'landing page', 'web app'],
      scopeDetails: ['scope', 'page count', 'screen count', 'user journey'],
      integrations: ['integration', 'third party', 'external service'],
      adminNeeds: ['admin', 'dashboard', 'back office'],
      deliverables: ['deliverable', 'handover', 'receive at the end'],
    };

    for (const [field, markers] of Object.entries(markersByField)) {
      if (markers.some((marker) => normalized.includes(marker))) return field;
    }

    if (
      isUncertainAnswer(latestMessage) ||
      /\b(?:suggest|recommend|help me (?:choose|decide)|what do you mean|explain this)\b/.test(
        normalized,
      )
    ) {
      return pendingField;
    }

    return null;
  }
}
