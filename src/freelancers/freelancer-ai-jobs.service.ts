import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AiService } from 'src/agents/ai.service';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AiJobsProducer } from 'src/queues/ai-jobs.producer';
import {
  AssessmentGenerationJobData,
  CvExtractionJobData,
} from 'src/queues/queue.types';
import { FreelancerAssessment } from './entities/freelancer-assessment.entity';
import { FreelancerAssessmentQuestion } from './entities/freelancer-assessment-question.entity';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { FreelancerVerificationEvent } from './entities/freelancer-verification-event.entity';

const DEFAULT_QUESTION_COUNT = 40;
const DEFAULT_DURATION_SECONDS = 2700;
const OPEN_ASSESSMENT_STATUSES = [
  'pending',
  'generating',
  'ready',
  'in_progress',
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
    private readonly aiService: AiService,
    private readonly aiJobsProducer: AiJobsProducer,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  async processCvExtraction(data: CvExtractionJobData, attemptsMade: number) {
    await this.markJobRunning(data.agentJobId, attemptsMade);

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
      profile.assessmentGenerationStatus = 'pending';
      profile.assessmentGenerationError = null;
      profile.verificationStatus = 'assessment_pending';

      const savedProfile = await this.profileRepository.save(profile);
      cvSaved = true;
      await this.recordVerificationEvent(this.dataSource.manager, {
        profile: savedProfile,
        eventType: 'cv_extraction_completed',
        fromStatus: previousStatus,
        toStatus: savedProfile.verificationStatus,
        actorType: 'ai',
        metadata: {
          agentJobId: data.agentJobId,
          confidence: result.confidence ?? null,
          skillsCount: skills.length,
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
        },
      });

      await this.markJobCompleted(data.agentJobId, {
        skillsCount: skills.length,
        assessmentGenerationJobId: generationJob.id,
      });
    } catch (error) {
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
      await this.markJobFailed(data.agentJobId, error);
      throw error;
    }
  }

  async processAssessmentGeneration(
    data: AssessmentGenerationJobData,
    attemptsMade: number,
  ) {
    await this.markJobRunning(data.agentJobId, attemptsMade);

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
      await this.markAssessmentGenerationFailed(
        data.profileId,
        data.userId,
        this.getErrorMessage(error),
        data.agentJobId,
        assessmentId,
      );
      await this.markJobFailed(data.agentJobId, error);
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
          generationJobId: data.agentJobId,
          generationInput: {
            cvUrl: data.cvUrl,
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

    const previousStatus = profile.verificationStatus ?? null;
    profile.cvExtractionStatus = 'failed';
    profile.cvExtractionError = error;
    profile.verificationStatus = 'cv_pending';
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
      profile.verificationStatus = 'assessment_pending';
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

  private async markJobRunning(agentJobId: string, attemptsMade: number) {
    await this.agentJobRepository.update(
      { id: agentJobId },
      {
        status: 'running',
        attempts: attemptsMade + 1,
        lockedAt: new Date(),
        startedAt: new Date(),
        error: null,
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

  private async markJobFailed(agentJobId: string, error: unknown) {
    await this.agentJobRepository.update(
      { id: agentJobId },
      {
        status: 'failed',
        error: this.getErrorMessage(error),
        failedAt: new Date(),
        lockedAt: null,
      },
    );
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
