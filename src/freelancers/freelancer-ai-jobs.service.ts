import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AiService } from 'src/agents/ai.service';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AiJobsProducer } from 'src/queues/ai-jobs.producer';
import {
  AssessmentGenerationJobData,
  CvExtractionJobData,
  ProfileEmbeddingJobData,
} from 'src/queues/queue.types';
import { AI_JOB_RETRY } from 'src/queues/queue.constants';
import { FreelancerAssessment } from './entities/freelancer-assessment.entity';
import { FreelancerAssessmentQuestion } from './entities/freelancer-assessment-question.entity';
import { FreelancerCvVersion } from './entities/freelancer-cv-version.entity';
import { FreelancerProfileEmbedding } from './entities/freelancer-profile-embedding.entity';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { FreelancerSkillScore } from './entities/freelancer-skill-score.entity';
import { FreelancerVerificationEvent } from './entities/freelancer-verification-event.entity';

const DEFAULT_QUESTION_COUNT = 40;
const DEFAULT_DURATION_SECONDS = 2700;
const PROFILE_EMBEDDING_DIMENSIONS = 1024;
const PROFILE_EMBEDDING_MODEL = 'nexus-freelancer-profile-v1';
const PROFILE_EMBEDDING_PROVIDER_MODEL = 'gemini-embedding-001';
const OPEN_ASSESSMENT_STATUSES = [
  'pending',
  'generating',
  'ready',
  'in_progress',
];
const ASSESSMENT_ATTEMPT_COUNT_STATUSES = [
  'in_progress',
  'submitted',
  'needs_review',
  'passed',
  'failed',
  'expired',
];

interface CvExtractionResult {
  headline?: string | null;
  skills?: string[] | null;
  yearsExperience?: number | null;
  confidence?: number | null;
}

interface GeneratedQuestion {
  questionType: string;
  skill?: string | null;
  difficulty?: string | null;
  prompt: string;
  choices?: Record<string, unknown> | unknown[] | null;
  rubric?: Record<string, unknown> | null;
  orderIndex?: number;
}

interface GeneratedAssessment {
  durationSeconds?: number;
  questions: GeneratedQuestion[];
}

interface AssessmentGenerationReservation {
  assessment: FreelancerAssessment;
  profile: FreelancerProfile;
  skills: string[];
}

interface SkillDiff {
  newSkills: string[];
  retainedSkills: string[];
  removedSkills: string[];
}

@Injectable()
export class FreelancerAiJobsService {
  private readonly logger = new Logger(FreelancerAiJobsService.name);

  constructor(
    @InjectRepository(AgentJob)
    private readonly agentJobRepository: Repository<AgentJob>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepository: Repository<FreelancerProfile>,
    @InjectRepository(FreelancerAssessment)
    private readonly assessmentRepository: Repository<FreelancerAssessment>,
    @InjectRepository(FreelancerAssessmentQuestion)
    private readonly questionRepository: Repository<FreelancerAssessmentQuestion>,
    @InjectRepository(FreelancerCvVersion)
    private readonly cvVersionRepository: Repository<FreelancerCvVersion>,
    @InjectRepository(FreelancerProfileEmbedding)
    private readonly profileEmbeddingRepository: Repository<FreelancerProfileEmbedding>,
    @InjectRepository(FreelancerSkillScore)
    private readonly skillScoreRepository: Repository<FreelancerSkillScore>,
    private readonly aiService: AiService,
    private readonly aiJobsProducer: AiJobsProducer,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  async processCvExtraction(
    data: CvExtractionJobData,
    attemptsMade: number,
    maxAttempts: number = AI_JOB_RETRY.ATTEMPTS,
  ) {
    await this.markJobRunning(data.agentJobId, attemptsMade, maxAttempts);

    let cvSaved = false;
    try {
      const profile = await this.profileRepository.findOne({
        where: { id: data.profileId, userId: data.userId },
      });

      if (!profile || profile.cvUrl !== data.cvUrl) {
        await this.markJobCancelled(data.agentJobId, {
          reason: 'stale_cv_extraction_job',
        });
        return;
      }

      await this.markCvProcessing(profile);

      const result = (await this.aiService.extractCv({
        cvUrl: data.cvUrl,
      })) as CvExtractionResult;
      const skills = this.normalizeSkills(result.skills ?? []);

      if (skills.length === 0) {
        throw new Error('The CV extractor did not return any skills');
      }

      const previousSkills = this.normalizeSkills(profile.skills ?? []);
      const skillDiff = this.diffSkills(previousSkills, skills);
      const cvVersion = await this.getCvVersion(data.profileId, data.cvUrl);
      const previousStatus = profile.verificationStatus ?? null;
      if (this.hasText(result.headline)) {
        profile.headline = result.headline.trim();
      }
      profile.skills = skills;
      if (
        typeof result.yearsExperience === 'number' &&
        Number.isInteger(result.yearsExperience) &&
        result.yearsExperience >= 0
      ) {
        profile.yearsExperience = result.yearsExperience;
      }
      profile.cvExtractionStatus = 'completed';
      profile.cvExtractionError = null;
      profile.cvExtractedAt = new Date();
      profile.currentCvVersionId = cvVersion?.id ?? profile.currentCvVersionId;
      profile.assessmentGenerationStatus = 'pending';
      profile.assessmentGenerationError = null;
      profile.verificationStatus = 'assessment_pending';

      const savedProfile = await this.profileRepository.save(profile);
      if (cvVersion) {
        await this.markCvVersionActive(cvVersion, {
          skills,
          skillDiff,
          confidence: result.confidence ?? null,
          agentJobId: data.agentJobId,
        });
      }
      cvSaved = true;
      await this.recordVerificationEvent(this.dataSource.manager, {
        profile: savedProfile,
        eventType: 'cv_extraction_completed',
        fromStatus: previousStatus,
        toStatus: savedProfile.verificationStatus,
        actorType: 'ai',
        metadata: {
          agentJobId: data.agentJobId,
          cvVersionId: cvVersion?.id ?? null,
          confidence: result.confidence ?? null,
          skillsCount: skills.length,
          newSkills: skillDiff.newSkills,
          removedSkills: skillDiff.removedSkills,
        },
      });

      const generationJob = await this.aiJobsProducer.emitCvExtracted({
        userId: data.userId,
        profileId: data.profileId,
        cvUrl: data.cvUrl,
        questionCount: DEFAULT_QUESTION_COUNT,
        durationSeconds: DEFAULT_DURATION_SECONDS,
      });

      savedProfile.assessmentGenerationStatus = 'queued';
      savedProfile.assessmentGenerationQueuedAt = new Date();
      savedProfile.assessmentGenerationStartedAt = null;
      savedProfile.assessmentGeneratedAt = null;
      savedProfile.assessmentGenerationError = null;
      savedProfile.assessmentGenerationJobId = generationJob.id;
      const queuedProfile = await this.profileRepository.save(savedProfile);
      await this.recordVerificationEvent(this.dataSource.manager, {
        profile: queuedProfile,
        eventType: 'assessment_generation_queued',
        fromStatus: queuedProfile.verificationStatus,
        toStatus: queuedProfile.verificationStatus,
        actorType: 'system',
        metadata: {
          agentJobId: generationJob.id,
          queueName: generationJob.queueName,
          cvVersionId: cvVersion?.id ?? null,
        },
      });

      await this.markJobCompleted(data.agentJobId, {
        skillsCount: skills.length,
        assessmentGenerationJobId: generationJob.id,
      });
    } catch (error) {
      if (this.isFinalAttempt(attemptsMade, maxAttempts)) {
        if (cvSaved) {
          await this.markAssessmentGenerationFailed(
            data.profileId,
            data.userId,
            this.getErrorMessage(error),
            data.agentJobId,
          );
        } else {
          await this.markCvExtractionFailed(
            data.profileId,
            data.userId,
            data.cvUrl,
            this.getErrorMessage(error),
            data.agentJobId,
          );
        }
        await this.markJobFailed(data.agentJobId, error, maxAttempts);
      } else {
        await this.markJobRetrying(
          data.agentJobId,
          error,
          attemptsMade,
          maxAttempts,
        );
      }
      throw error;
    }
  }

  async processAssessmentGeneration(
    data: AssessmentGenerationJobData,
    attemptsMade: number,
    maxAttempts: number = AI_JOB_RETRY.ATTEMPTS,
  ) {
    await this.markJobRunning(data.agentJobId, attemptsMade, maxAttempts);

    let assessmentId: string | null = null;
    try {
      const reservation = await this.reserveAssessmentGeneration(data);
      if (!reservation) {
        await this.markJobCancelled(data.agentJobId, {
          reason: 'stale_assessment_generation_job',
        });
        return;
      }

      assessmentId = reservation.assessment.id;
      if (reservation.assessment.status === 'ready') {
        await this.markJobCompleted(data.agentJobId, {
          assessmentId: reservation.assessment.id,
          alreadyReady: true,
        });
        return;
      }

      const generated = (await this.aiService.generateAssessment({
        cvUrl: data.cvUrl,
        skills: reservation.skills,
        yearsExperience: reservation.profile.yearsExperience ?? undefined,
        headline: reservation.profile.headline ?? undefined,
        questionCount: data.questionCount,
        durationSeconds: data.durationSeconds,
      })) as GeneratedAssessment;

      if (!generated?.questions?.length) {
        throw new Error('The assessment generator did not return questions');
      }

      await this.saveGeneratedAssessment(data, reservation, generated);
      await this.markJobCompleted(data.agentJobId, {
        assessmentId: reservation.assessment.id,
        questionCount: generated.questions.length,
      });
    } catch (error) {
      if (this.isFinalAttempt(attemptsMade, maxAttempts)) {
        await this.markAssessmentGenerationFailed(
          data.profileId,
          data.userId,
          this.getErrorMessage(error),
          data.agentJobId,
          assessmentId,
        );
        await this.markJobFailed(data.agentJobId, error, maxAttempts);
      } else {
        await this.markJobRetrying(
          data.agentJobId,
          error,
          attemptsMade,
          maxAttempts,
        );
      }
      throw error;
    }
  }

  async processProfileEmbedding(
    data: ProfileEmbeddingJobData,
    attemptsMade: number,
    maxAttempts: number = AI_JOB_RETRY.ATTEMPTS,
  ) {
    await this.markJobRunning(data.agentJobId, attemptsMade, maxAttempts);

    try {
      const profile = await this.profileRepository.findOne({
        where: { id: data.profileId, userId: data.userId },
        relations: ['user'],
      });

      if (!profile) {
        await this.markJobCancelled(data.agentJobId, {
          reason: 'stale_profile_embedding_job',
        });
        return;
      }

      const assessment = data.assessmentId
        ? await this.assessmentRepository.findOne({
            where: { id: data.assessmentId },
          })
        : await this.assessmentRepository.findOne({
            where: { freelancerProfileId: data.profileId },
            order: { submittedAt: 'DESC', createdAt: 'DESC' },
          });

      if (
        data.assessmentId &&
        (!assessment || assessment.freelancerProfileId !== profile.id)
      ) {
        await this.markJobCancelled(data.agentJobId, {
          reason: 'stale_assessment_embedding_job',
          assessmentId: data.assessmentId,
        });
        return;
      }

      const skillScores = await this.skillScoreRepository.find({
        where: { freelancerProfileId: profile.id },
        order: { score: 'DESC', skill: 'ASC' },
      });
      const sourceText = this.buildProfileEmbeddingSourceText(
        profile,
        skillScores,
        assessment,
      );

      if (!sourceText.trim()) {
        await this.markJobCancelled(data.agentJobId, {
          reason: 'empty_profile_embedding_source',
        });
        return;
      }

      const generated = await this.aiService.generateEmbedding({
        text: sourceText,
        dimensions: PROFILE_EMBEDDING_DIMENSIONS,
        model: PROFILE_EMBEDDING_PROVIDER_MODEL,
      });
      const embedding = this.normalizeEmbedding(generated.embedding);
      const embeddingModel = PROFILE_EMBEDDING_MODEL;
      const providerModel = generated.model ?? PROFILE_EMBEDDING_PROVIDER_MODEL;

      const embeddingRow = {
        freelancerProfileId: profile.id,
        embeddingModel,
        sourceText,
        dimensions: embedding.length,
        embedding: this.toVectorLiteral(embedding),
        metadata: {
          reason: data.reason,
          agentJobId: data.agentJobId,
          assessmentId: assessment?.id ?? data.assessmentId ?? null,
          assessmentScore: assessment?.score ?? null,
          skillScoresCount: skillScores.length,
          generatedDimensions: generated.dimensions ?? null,
          providerModel,
        },
      } as QueryDeepPartialEntity<FreelancerProfileEmbedding>;

      await this.profileEmbeddingRepository.upsert(embeddingRow, [
        'freelancerProfileId',
        'embeddingModel',
      ]);

      await this.recordVerificationEvent(this.dataSource.manager, {
        profile,
        eventType: 'profile_embedding_generated',
        fromStatus: profile.verificationStatus ?? null,
        toStatus: profile.verificationStatus ?? null,
        actorType: 'ai',
        metadata: {
          agentJobId: data.agentJobId,
          assessmentId: assessment?.id ?? data.assessmentId ?? null,
          embeddingModel,
          providerModel,
          dimensions: embedding.length,
          reason: data.reason,
        },
      });

      await this.markJobCompleted(data.agentJobId, {
        profileId: profile.id,
        assessmentId: assessment?.id ?? data.assessmentId ?? null,
        embeddingModel,
        providerModel,
        dimensions: embedding.length,
        sourceTextLength: sourceText.length,
      });
    } catch (error) {
      if (this.isFinalAttempt(attemptsMade, maxAttempts)) {
        await this.markJobFailed(data.agentJobId, error, maxAttempts);
      } else {
        await this.markJobRetrying(
          data.agentJobId,
          error,
          attemptsMade,
          maxAttempts,
        );
      }
      throw error;
    }
  }

  private async reserveAssessmentGeneration(
    data: AssessmentGenerationJobData,
  ): Promise<AssessmentGenerationReservation | null> {
    return this.dataSource.transaction(async (manager) => {
      const profile = await manager
        .getRepository(FreelancerProfile)
        .createQueryBuilder('profile')
        .setLock('pessimistic_write')
        .where('profile.id = :profileId', { profileId: data.profileId })
        .andWhere('profile.userId = :userId', { userId: data.userId })
        .getOne();

      if (!profile || profile.cvUrl !== data.cvUrl) return null;

      const skills = this.normalizeSkills(profile.skills ?? []);
      if (skills.length === 0) {
        throw new Error('Assessment generation requires extracted CV skills');
      }

      const openAssessment = await manager.findOne(FreelancerAssessment, {
        where: {
          userId: data.userId,
          status: In(OPEN_ASSESSMENT_STATUSES),
        },
        order: { createdAt: 'DESC' },
      });

      if (openAssessment) {
        if (openAssessment.status === 'ready') {
          await this.markProfileAssessmentReady(manager, profile, {
            agentJobId: data.agentJobId,
            assessmentId: openAssessment.id,
            generatedAt: openAssessment.generatedAt ?? new Date(),
          });
          return { assessment: openAssessment, profile, skills };
        }

        if (openAssessment.generationJobId !== data.agentJobId) {
          return null;
        }

        profile.assessmentGenerationStatus = 'processing';
        profile.assessmentGenerationStartedAt ??= new Date();
        profile.assessmentGenerationJobId = data.agentJobId;
        await manager.save(FreelancerProfile, profile);

        return { assessment: openAssessment, profile, skills };
      }

      const assessment = await manager.save(
        FreelancerAssessment,
        manager.create(FreelancerAssessment, {
          userId: data.userId,
          freelancerProfileId: data.profileId,
          status: 'generating',
          durationSeconds: data.durationSeconds,
          startedAt: null,
          expiresAt: null,
          submittedAt: null,
          generatedFromCvUrl: data.cvUrl,
          cvVersionId: profile.currentCvVersionId,
          generationJobId: data.agentJobId,
          attemptNumber:
            (await this.countAssessmentAttempts(manager, data.userId)) + 1,
          generationInput: {
            cvUrl: data.cvUrl,
            cvVersionId: profile.currentCvVersionId,
            skills,
            yearsExperience: profile.yearsExperience,
            headline: profile.headline,
            questionCount: data.questionCount,
            durationSeconds: data.durationSeconds,
          },
        }),
      );

      await manager.update(
        AgentJob,
        { id: data.agentJobId },
        { assessmentId: assessment.id },
      );

      const previousStatus = profile.verificationStatus ?? null;
      profile.assessmentGenerationStatus = 'processing';
      profile.assessmentGenerationStartedAt = new Date();
      profile.assessmentGenerationError = null;
      profile.assessmentGenerationJobId = data.agentJobId;
      profile.verificationStatus = 'assessment_pending';
      const savedProfile = await manager.save(FreelancerProfile, profile);
      await this.recordVerificationEvent(manager, {
        profile: savedProfile,
        eventType: 'assessment_generation_started',
        fromStatus: previousStatus,
        toStatus: savedProfile.verificationStatus,
        actorType: 'system',
        metadata: {
          agentJobId: data.agentJobId,
          assessmentId: assessment.id,
        },
      });

      return { assessment, profile: savedProfile, skills };
    });
  }

  private async saveGeneratedAssessment(
    data: AssessmentGenerationJobData,
    reservation: AssessmentGenerationReservation,
    generated: GeneratedAssessment,
  ) {
    const generatedAt = new Date();
    await this.dataSource.transaction(async (manager) => {
      const assessment = await manager.findOne(FreelancerAssessment, {
        where: { id: reservation.assessment.id },
      });
      if (!assessment || assessment.status !== 'generating') return;

      const finalDuration =
        generated.durationSeconds ?? assessment.durationSeconds;
      assessment.status = 'ready';
      assessment.durationSeconds = finalDuration;
      assessment.generatedAt = generatedAt;
      assessment.generationError = null;
      await manager.save(FreelancerAssessment, assessment);

      const questions = generated.questions.map((question, index) =>
        manager.create(FreelancerAssessmentQuestion, {
          assessmentId: assessment.id,
          questionType: question.questionType,
          skill: question.skill ?? null,
          difficulty: question.difficulty ?? null,
          prompt: question.prompt,
          choices: this.normalizeChoices(question.choices),
          rubric: question.rubric ?? null,
          orderIndex: question.orderIndex ?? index + 1,
        }),
      );
      await manager.save(FreelancerAssessmentQuestion, questions);

      const profile = await manager.findOne(FreelancerProfile, {
        where: { id: data.profileId, userId: data.userId },
      });
      if (profile) {
        await this.markProfileAssessmentReady(manager, profile, {
          agentJobId: data.agentJobId,
          assessmentId: assessment.id,
          generatedAt,
        });
      }
    });

    await this.notificationsService.createNotification({
      userId: data.userId,
      title: 'Assessment ready',
      body: 'Your skills assessment is ready to start.',
    });
  }

  private async markProfileAssessmentReady(
    manager: EntityManager,
    profile: FreelancerProfile,
    input: { agentJobId: string; assessmentId: string; generatedAt: Date },
  ) {
    const previousStatus = profile.verificationStatus ?? null;
    profile.assessmentGenerationStatus = 'ready';
    profile.assessmentGeneratedAt = input.generatedAt;
    profile.assessmentGenerationError = null;
    profile.assessmentGenerationJobId = input.agentJobId;
    profile.verificationStatus = 'assessment_pending';
    const savedProfile = await manager.save(FreelancerProfile, profile);
    await this.recordVerificationEvent(manager, {
      profile: savedProfile,
      eventType: 'assessment_generated',
      fromStatus: previousStatus,
      toStatus: savedProfile.verificationStatus,
      actorType: 'ai',
      metadata: {
        agentJobId: input.agentJobId,
        assessmentId: input.assessmentId,
      },
    });
  }

  private async getCvVersion(profileId: string, cvUrl: string) {
    return this.cvVersionRepository.findOne({
      where: { freelancerProfileId: profileId, cvUrl },
      order: { createdAt: 'DESC' },
    });
  }

  private async markCvVersionActive(
    cvVersion: FreelancerCvVersion,
    input: {
      skills: string[];
      skillDiff: SkillDiff;
      confidence: number | null;
      agentJobId: string;
    },
  ) {
    await this.cvVersionRepository
      .createQueryBuilder()
      .update(FreelancerCvVersion)
      .set({ status: 'superseded' })
      .where('"freelancer_profile_id" = :profileId', {
        profileId: cvVersion.freelancerProfileId,
      })
      .andWhere('status = :status', { status: 'active' })
      .andWhere('id != :id', { id: cvVersion.id })
      .execute();

    cvVersion.status = 'active';
    cvVersion.extractedSkills = input.skills;
    cvVersion.newSkills = input.skillDiff.newSkills;
    cvVersion.retainedSkills = input.skillDiff.retainedSkills;
    cvVersion.removedSkills = input.skillDiff.removedSkills;
    cvVersion.extractionError = null;
    cvVersion.extractedAt = new Date();
    cvVersion.metadata = {
      ...(cvVersion.metadata ?? {}),
      confidence: input.confidence,
      agentJobId: input.agentJobId,
    };
    await this.cvVersionRepository.save(cvVersion);
  }

  private async markCvVersionExtractionFailed(
    profileId: string,
    cvUrl: string,
    error: string,
    agentJobId: string,
  ) {
    const cvVersion = await this.getCvVersion(profileId, cvUrl);
    if (!cvVersion) return;

    cvVersion.status = 'extraction_failed';
    cvVersion.extractionError = error;
    cvVersion.metadata = {
      ...(cvVersion.metadata ?? {}),
      failedAgentJobId: agentJobId,
    };
    await this.cvVersionRepository.save(cvVersion);
  }

  private diffSkills(
    previousSkills: string[],
    nextSkills: string[],
  ): SkillDiff {
    const previousByKey = new Map(
      previousSkills.map((skill) => [skill.toLowerCase(), skill]),
    );
    const nextByKey = new Map(
      nextSkills.map((skill) => [skill.toLowerCase(), skill]),
    );

    return {
      newSkills: nextSkills.filter(
        (skill) => !previousByKey.has(skill.toLowerCase()),
      ),
      retainedSkills: nextSkills.filter((skill) =>
        previousByKey.has(skill.toLowerCase()),
      ),
      removedSkills: previousSkills.filter(
        (skill) => !nextByKey.has(skill.toLowerCase()),
      ),
    };
  }

  private async countAssessmentAttempts(
    manager: EntityManager,
    userId: string,
  ) {
    return manager.count(FreelancerAssessment, {
      where: {
        userId,
        status: In(ASSESSMENT_ATTEMPT_COUNT_STATUSES),
      },
    });
  }

  private buildProfileEmbeddingSourceText(
    profile: FreelancerProfile,
    skillScores: FreelancerSkillScore[],
    assessment: FreelancerAssessment | null,
  ) {
    const userName = [profile.user?.firstName, profile.user?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const summary = this.getProfileSummaryText(profile.summary);
    const aiFeedback = assessment?.aiFeedback as
      | {
          recommendation?: unknown;
          feedback?: unknown;
          profileSummary?: unknown;
        }
      | null
      | undefined;

    const skillRatings = skillScores
      .slice(0, 50)
      .map((skillScore) => {
        const confidence = skillScore.confidence
          ? `, confidence ${skillScore.confidence}`
          : '';
        return `${skillScore.skill}: ${skillScore.score}/5${confidence}`;
      })
      .join('\n');

    const sections = [
      userName ? `Freelancer: ${userName}` : null,
      profile.headline ? `Headline: ${profile.headline}` : null,
      profile.bio ? `Bio: ${profile.bio}` : null,
      profile.yearsExperience != null
        ? `Years of experience: ${profile.yearsExperience}`
        : null,
      profile.availabilityHoursPerWeek != null
        ? `Availability: ${profile.availabilityHoursPerWeek} hours per week`
        : null,
      profile.hourlyRate ? `Hourly rate: ${profile.hourlyRate}` : null,
      profile.assessmentScore
        ? `Assessment score: ${profile.assessmentScore}`
        : null,
      typeof aiFeedback?.recommendation === 'string'
        ? `AI recommendation: ${aiFeedback.recommendation}`
        : null,
      profile.skills?.length ? `CV skills: ${profile.skills.join(', ')}` : null,
      summary ? `Assessment profile summary: ${summary}` : null,
      typeof aiFeedback?.feedback === 'string'
        ? `Assessment feedback: ${aiFeedback.feedback}`
        : null,
      skillRatings ? `Assessed skill ratings:\n${skillRatings}` : null,
    ].filter((section): section is string => Boolean(section?.trim()));

    return sections.join('\n\n').slice(0, 8000);
  }

  private getProfileSummaryText(summary: Record<string, unknown> | null) {
    if (!summary) return null;
    if (typeof summary.profileSummary === 'string') {
      return summary.profileSummary.trim();
    }
    if (typeof summary.summary === 'string') {
      return summary.summary.trim();
    }
    return null;
  }

  private normalizeEmbedding(embedding: unknown) {
    if (!Array.isArray(embedding)) {
      throw new Error('The embedding generator did not return an embedding');
    }

    const values = embedding.map((value) => Number(value));
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error('The embedding generator returned invalid numbers');
    }
    if (values.length !== PROFILE_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `The embedding generator returned ${values.length} dimensions instead of ${PROFILE_EMBEDDING_DIMENSIONS}`,
      );
    }

    return values;
  }

  private toVectorLiteral(embedding: number[]) {
    return `[${embedding.join(',')}]`;
  }

  private async markCvProcessing(profile: FreelancerProfile) {
    const previousStatus = profile.verificationStatus ?? null;
    profile.cvExtractionStatus = 'processing';
    profile.cvExtractionError = null;
    profile.verificationStatus = 'cv_processing';
    const savedProfile = await this.profileRepository.save(profile);
    await this.recordVerificationEvent(this.dataSource.manager, {
      profile: savedProfile,
      eventType: 'cv_extraction_started',
      fromStatus: previousStatus,
      toStatus: savedProfile.verificationStatus,
      actorType: 'system',
    });
  }

  private async markCvExtractionFailed(
    profileId: string,
    userId: string,
    cvUrl: string,
    error: string,
    agentJobId: string,
  ) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId, userId, cvUrl },
    });
    if (!profile) return;

    await this.markCvVersionExtractionFailed(
      profileId,
      cvUrl,
      error,
      agentJobId,
    );
    const previousStatus = profile.verificationStatus ?? null;
    profile.cvExtractionStatus = 'failed';
    profile.cvExtractionError = error;
    profile.verificationStatus = 'cv_extraction_failed';
    const savedProfile = await this.profileRepository.save(profile);
    await this.recordVerificationEvent(this.dataSource.manager, {
      profile: savedProfile,
      eventType: 'cv_extraction_failed',
      fromStatus: previousStatus,
      toStatus: savedProfile.verificationStatus,
      actorType: 'ai',
      metadata: { agentJobId, error },
    });
    this.logger.error(
      `CV extraction failed for profile ${profileId}: ${error}`,
    );
  }

  private async markAssessmentGenerationFailed(
    profileId: string,
    userId: string,
    error: string,
    agentJobId: string,
    assessmentId?: string | null,
  ) {
    const profile = await this.profileRepository.findOne({
      where: { id: profileId, userId },
    });
    if (profile) {
      const previousStatus = profile.verificationStatus ?? null;
      profile.assessmentGenerationStatus = 'failed';
      profile.assessmentGenerationError = error;
      profile.verificationStatus = 'assessment_generation_failed';
      const savedProfile = await this.profileRepository.save(profile);
      await this.recordVerificationEvent(this.dataSource.manager, {
        profile: savedProfile,
        eventType: 'assessment_generation_failed',
        fromStatus: previousStatus,
        toStatus: savedProfile.verificationStatus,
        actorType: 'ai',
        metadata: { agentJobId, assessmentId: assessmentId ?? null, error },
      });
    }

    if (assessmentId) {
      await this.assessmentRepository.update(
        { id: assessmentId, status: In(['pending', 'generating']) },
        { status: 'generation_failed', generationError: error },
      );
    }
  }

  private async markJobRunning(
    agentJobId: string,
    attemptsMade: number,
    maxAttempts: number,
  ) {
    await this.agentJobRepository.update(
      { id: agentJobId },
      {
        status: 'running',
        attempts: attemptsMade + 1,
        maxAttempts,
        lockedAt: new Date(),
        startedAt: new Date(),
        error: null,
        failedAt: null,
      },
    );
  }

  private async markJobCompleted(
    agentJobId: string,
    output: Record<string, unknown>,
  ) {
    const agentJob = await this.agentJobRepository.findOne({
      where: { id: agentJobId },
    });
    if (!agentJob) return;

    agentJob.status = 'completed';
    agentJob.output = output;
    agentJob.completedAt = new Date();
    agentJob.lockedAt = null;
    agentJob.error = null;
    await this.agentJobRepository.save(agentJob);
  }

  private async markJobCancelled(
    agentJobId: string,
    output: Record<string, unknown>,
  ) {
    const agentJob = await this.agentJobRepository.findOne({
      where: { id: agentJobId },
    });
    if (!agentJob) return;

    agentJob.status = 'cancelled';
    agentJob.output = output;
    agentJob.completedAt = new Date();
    agentJob.lockedAt = null;
    await this.agentJobRepository.save(agentJob);
  }

  private async markJobRetrying(
    agentJobId: string,
    error: unknown,
    attemptsMade: number,
    maxAttempts: number,
  ) {
    const currentAttempt = attemptsMade + 1;
    await this.agentJobRepository.update(
      { id: agentJobId },
      {
        status: 'queued',
        attempts: currentAttempt,
        maxAttempts,
        error: this.getErrorMessage(error),
        output: {
          retrying: true,
          attempt: currentAttempt,
          maxAttempts,
        },
        lockedAt: null,
        failedAt: null,
      },
    );
    this.logger.warn(
      `AI job ${agentJobId} failed attempt ${currentAttempt}/${maxAttempts}; BullMQ will retry: ${this.getErrorMessage(error)}`,
    );
  }

  private async markJobFailed(
    agentJobId: string,
    error: unknown,
    maxAttempts: number = AI_JOB_RETRY.ATTEMPTS,
  ) {
    await this.agentJobRepository.update(
      { id: agentJobId },
      {
        status: 'failed',
        error: this.getErrorMessage(error),
        maxAttempts,
        failedAt: new Date(),
        lockedAt: null,
      },
    );
  }

  private isFinalAttempt(attemptsMade: number, maxAttempts: number) {
    return attemptsMade + 1 >= maxAttempts;
  }

  private async recordVerificationEvent(
    manager: EntityManager,
    input: {
      profile: FreelancerProfile;
      eventType: string;
      fromStatus: string | null;
      toStatus: string | null;
      actorType: string;
      actorUserId?: string | null;
      metadata?: Record<string, unknown> | null;
    },
  ) {
    await manager.save(
      FreelancerVerificationEvent,
      manager.create(FreelancerVerificationEvent, {
        freelancerProfileId: input.profile.id,
        userId: input.profile.userId,
        eventType: input.eventType,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actorType: input.actorType,
        actorUserId: input.actorUserId ?? null,
        metadata: input.metadata ?? null,
      }),
    );
  }

  private normalizeSkills(skills: string[]) {
    return Array.from(
      new Set(
        skills
          .map((skill) => skill.trim())
          .filter(Boolean)
          .map((skill) => skill.slice(0, 80)),
      ),
    ).slice(0, 40);
  }

  private normalizeChoices(
    choices: Record<string, unknown> | unknown[] | null | undefined,
  ) {
    if (!choices) return null;
    if (Array.isArray(choices)) return choices;
    const options = choices.options;
    if (Array.isArray(options)) return options.map((option: unknown) => option);
    return choices;
  }

  private hasText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message.slice(0, 1000);
    return String(error).slice(0, 1000);
  }
}
