import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AiService } from 'src/agents/ai.service';
import { Notification } from 'src/notifications/entities/notification.entity';
import { ReviewAssessmentDto } from 'src/admin/dtos/review-assessment.dto';
import { FreelancerAssessment } from './entities/freelancer-assessment.entity';
import { FreelancerAssessmentAnswer } from './entities/freelancer-assessment-answer.entity';
import { FreelancerAssessmentEvent } from './entities/freelancer-assessment-event.entity';
import { FreelancerAssessmentQuestion } from './entities/freelancer-assessment-question.entity';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { FreelancerSkillScore } from './entities/freelancer-skill-score.entity';
import { FreelancerVerificationEvent } from './entities/freelancer-verification-event.entity';
import { SaveAssessmentAnswersDto } from './dtos/save-assessment-answers.dto';
import { SubmitAssessmentDto } from './dtos/submit-assessment.dto';
import { TrackAssessmentEventDto } from './dtos/track-assessment-event.dto';

const MAX_WARNING_COUNT = 3;
const ACTIVE_STATUS = 'in_progress';
const SUBMITTED_STATUSES = new Set([
  'submitted',
  'graded',
  'needs_review',
  'passed',
  'failed',
]);
const WARNING_EVENT_TYPES = [
  'fullscreen_exit',
  'visibility_hidden',
  'copy_attempt',
  'paste_attempt',
];

const ANTI_CHEAT = {
  trackFocusLoss: true,
  trackCopyPaste: true,
  requireFullscreen: true,
};

interface GradedQuestionResult {
  questionId: string;
  score?: number;
  maxScore?: number;
  feedback?: string;
}

interface GradedAssessment {
  score?: number;
  maxScore?: number;
  recommendation?: string;
  feedback?: string;
  profileSummary?: string;
  graderConfidence?: number;
  questionResults?: GradedQuestionResult[];
}

@Injectable()
export class FreelancerAssessmentsService {
  constructor(
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    @InjectRepository(FreelancerAssessment)
    private readonly assessmentRepo: Repository<FreelancerAssessment>,
    @InjectRepository(FreelancerAssessmentQuestion)
    private readonly questionRepo: Repository<FreelancerAssessmentQuestion>,
    @InjectRepository(FreelancerAssessmentAnswer)
    private readonly answerRepo: Repository<FreelancerAssessmentAnswer>,
    @InjectRepository(FreelancerAssessmentEvent)
    private readonly eventRepo: Repository<FreelancerAssessmentEvent>,
    @InjectRepository(FreelancerSkillScore)
    private readonly skillScoreRepo: Repository<FreelancerSkillScore>,
    private readonly aiService: AiService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Freelancer: verification checklist
  // ---------------------------------------------------------------------------

  async getVerification(userId: string, emailVerified: boolean) {
    const profile = await this.getProfileWithUser(userId);
    const latest = await this.getLatestAssessment(userId);

    const skillScoreCount = await this.skillScoreRepo.count({
      where: { freelancerProfileId: profile.id },
    });
    const profileComplete = this.isAssessmentProfileComplete(
      profile,
      skillScoreCount,
    );
    const cvUploaded = Boolean(profile.cvUrl);
    const cvExtracted = this.isCvExtracted(profile);
    const missing = this.getMissingProfilePieces(profile);

    const { verificationStatus, nextAction } = this.deriveVerification({
      profile,
      latest,
      profileComplete,
      cvUploaded,
      emailVerified,
    });

    return {
      userId,
      profileId: profile.id,
      verificationStatus,
      profileComplete,
      emailVerified,
      cvUploaded,
      cvExtracted,
      cvExtractionStatus: profile.cvExtractionStatus,
      cvExtractedAt: profile.cvExtractedAt,
      cvExtractionError: profile.cvExtractionError,
      assessmentGenerationStatus: profile.assessmentGenerationStatus,
      assessmentGenerationQueuedAt: profile.assessmentGenerationQueuedAt,
      assessmentGenerationStartedAt: profile.assessmentGenerationStartedAt,
      assessmentGeneratedAt: profile.assessmentGeneratedAt,
      assessmentGenerationError: profile.assessmentGenerationError,
      nextAction,
      assessment: latest ? this.toAssessmentSummary(latest) : null,
      missing,
    };
  }

  // ---------------------------------------------------------------------------
  // Freelancer: start / reuse assessment
  // ---------------------------------------------------------------------------

  async start(userId: string) {
    const assessment = await this.dataSource.transaction(async (manager) => {
      const profile = await manager
        .getRepository(FreelancerProfile)
        .createQueryBuilder('profile')
        .setLock('pessimistic_write')
        .where('profile.userId = :userId', { userId })
        .getOne();

      if (!profile) {
        throw new NotFoundException('Freelancer profile not found');
      }

      this.getAssessmentStartInputs(profile);
      const latest = await this.getLatestAssessment(userId, manager);

      if (latest && latest.status === ACTIVE_STATUS) {
        if (!this.isExpired(latest)) {
          return latest;
        }
        latest.status = 'expired';
        await manager.save(FreelancerAssessment, latest);
      }

      if (latest && SUBMITTED_STATUSES.has(latest.status)) {
        throw new ConflictException(
          'Your latest assessment is already submitted and waiting for review',
        );
      }

      if (latest?.status === 'generating' || latest?.status === 'pending') {
        throw new ConflictException(
          'Your assessment is still being prepared. Please try again shortly.',
        );
      }

      const readyAssessment =
        latest?.status === 'ready'
          ? latest
          : await manager.findOne(FreelancerAssessment, {
              where: { userId, status: 'ready' },
              order: { createdAt: 'DESC' },
            });

      if (!readyAssessment) {
        if (profile.assessmentGenerationStatus === 'failed') {
          throw new BadRequestException(
            'Assessment generation failed. Please upload your CV again or contact support.',
          );
        }

        throw new ConflictException(
          'Your assessment is still being prepared. Please try again shortly.',
        );
      }

      const questionCount = await manager.count(FreelancerAssessmentQuestion, {
        where: { assessmentId: readyAssessment.id },
      });
      if (questionCount === 0) {
        throw new BadRequestException(
          'Your assessment is not ready yet. Please try again shortly.',
        );
      }

      const startedAt = new Date();
      const expiresAt = new Date(
        startedAt.getTime() + readyAssessment.durationSeconds * 1000,
      );
      readyAssessment.status = ACTIVE_STATUS;
      readyAssessment.startedAt = startedAt;
      readyAssessment.expiresAt = expiresAt;
      readyAssessment.submittedAt = null;
      await manager.save(FreelancerAssessment, readyAssessment);

      const previousStatus = profile.verificationStatus ?? null;
      profile.verificationStatus = 'assessment_in_progress';
      await manager.save(FreelancerProfile, profile);
      await this.recordVerificationEvent(manager, {
        profile,
        eventType: 'assessment_started',
        fromStatus: previousStatus,
        toStatus: profile.verificationStatus,
        actorType: 'freelancer',
        actorUserId: userId,
        metadata: {
          assessmentId: readyAssessment.id,
          questionCount,
          durationSeconds: readyAssessment.durationSeconds,
        },
      });

      return readyAssessment;
    });

    const safeQuestions = await this.getSafeQuestions(assessment.id);
    return this.buildStartResponse(assessment, safeQuestions);
  }

  // ---------------------------------------------------------------------------
  // Freelancer: current / by id
  // ---------------------------------------------------------------------------

  async getCurrent(userId: string) {
    const active = await this.assessmentRepo.findOne({
      where: { userId, status: ACTIVE_STATUS },
      order: { createdAt: 'DESC' },
    });
    const assessment = active ?? (await this.getLatestAssessment(userId));

    if (!assessment) {
      return { assessment: null, questions: [], answers: [], nextAction: null };
    }

    return this.buildDetailResponse(assessment);
  }

  async getById(userId: string, id: string) {
    const assessment = await this.assessmentRepo.findOne({ where: { id } });
    if (!assessment) throw new NotFoundException('Assessment not found');
    if (assessment.userId !== userId) {
      throw new ForbiddenException('You can only access your own assessment');
    }

    return this.buildDetailResponse(assessment);
  }

  // ---------------------------------------------------------------------------
  // Freelancer: save answers (autosave / upsert)
  // ---------------------------------------------------------------------------

  async saveAnswers(userId: string, id: string, dto: SaveAssessmentAnswersDto) {
    const assessment = await this.getOwnedAssessment(userId, id);

    if (assessment.status !== ACTIVE_STATUS) {
      throw new BadRequestException('This assessment is no longer open');
    }
    if (this.isExpired(assessment)) {
      throw new BadRequestException('This assessment has expired');
    }

    await this.upsertAnswers(id, dto.answers);
    const answers = await this.getSavedAnswers(id);
    return { answers };
  }

  // ---------------------------------------------------------------------------
  // Freelancer: track anti-cheat events
  // ---------------------------------------------------------------------------

  async trackEvent(userId: string, id: string, dto: TrackAssessmentEventDto) {
    return this.dataSource.transaction(async (manager) => {
      const assessment = await manager
        .getRepository(FreelancerAssessment)
        .createQueryBuilder('assessment')
        .setLock('pessimistic_write')
        .where('assessment.id = :id', { id })
        .andWhere('assessment.userId = :userId', { userId })
        .getOne();

      if (!assessment) throw new NotFoundException('Assessment not found');

      const event = await manager.save(
        FreelancerAssessmentEvent,
        manager.create(FreelancerAssessmentEvent, {
          assessmentId: assessment.id,
          eventType: dto.eventType,
          metadata: dto.metadata ?? null,
        }),
      );

      const warningsCount = await this.getWarningCount(assessment.id, manager);
      let cancelled = false;

      if (
        assessment.status === ACTIVE_STATUS &&
        WARNING_EVENT_TYPES.includes(dto.eventType) &&
        warningsCount >= MAX_WARNING_COUNT
      ) {
        cancelled = true;
        await this.cancelForWarnings(assessment, warningsCount, manager);
      }

      return {
        id: event.id,
        eventType: event.eventType,
        warningsCount,
        cancelled,
        createdAt: event.createdAt,
      };
    });
  }

  private async cancelForWarnings(
    assessment: FreelancerAssessment,
    warningsCount: number,
    manager: EntityManager,
  ) {
    const cancelledAt = new Date();
    assessment.status = 'failed';
    assessment.submittedAt = cancelledAt;
    assessment.score = '0';
    assessment.aiFeedback = {
      recommendation: 'fail',
      feedback:
        'Assessment automatically cancelled after repeated integrity warnings.',
      maxScore: 100,
      questionResults: [],
      reason: 'anti_cheat_cancelled',
      warningsCount,
    };
    await manager.save(FreelancerAssessment, assessment);

    const profile = await manager.findOne(FreelancerProfile, {
      where: { id: assessment.freelancerProfileId },
    });
    if (profile) {
      const previousStatus = profile.verificationStatus ?? null;
      profile.verificationStatus = 'rejected';
      profile.assessmentScore = '0';
      profile.assessmentSubmittedAt = cancelledAt;
      profile.rejectedAt = cancelledAt;
      profile.rejectionReason =
        'Assessment automatically cancelled after repeated integrity warnings.';
      await manager.save(FreelancerProfile, profile);
      await this.recordVerificationEvent(manager, {
        profile,
        eventType: 'assessment_cancelled',
        fromStatus: previousStatus,
        toStatus: profile.verificationStatus,
        actorType: 'system',
        metadata: {
          assessmentId: assessment.id,
          warningsCount,
          reason: 'anti_cheat_cancelled',
        },
      });
    }

    await manager.save(
      Notification,
      manager.create(Notification, {
        userId: assessment.userId,
        title: 'Assessment cancelled',
        body: 'Your assessment was cancelled after repeated integrity warnings.',
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Freelancer: submit + grade
  // ---------------------------------------------------------------------------

  async submit(userId: string, id: string, dto: SubmitAssessmentDto) {
    const owned = await this.getOwnedAssessment(userId, id);

    if (owned.status !== ACTIVE_STATUS) {
      return this.buildSubmitResponse(await this.reloadAssessment(id));
    }
    if (this.isExpired(owned)) {
      throw new BadRequestException('This assessment has expired');
    }

    const claimed = await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .getRepository(FreelancerAssessment)
        .createQueryBuilder('assessment')
        .setLock('pessimistic_write')
        .where('assessment.id = :id', { id })
        .getOne();

      if (!locked || locked.status !== ACTIVE_STATUS) {
        return null;
      }
      if (this.isExpired(locked)) {
        throw new BadRequestException('This assessment has expired');
      }

      if (dto.finalAnswers?.length) {
        await this.upsertAnswers(id, dto.finalAnswers, manager);
      }

      const questions = await manager.find(FreelancerAssessmentQuestion, {
        where: { assessmentId: id },
        select: {
          id: true,
          questionType: true,
          skill: true,
          difficulty: true,
          prompt: true,
          rubric: true,
        },
      });
      const answers = await manager.find(FreelancerAssessmentAnswer, {
        where: { assessmentId: id },
      });
      const answerByQuestion = new Map(
        answers.map((answer) => [answer.questionId, answer]),
      );

      const grade = (await Promise.resolve(
        this.aiService.gradeAssessment(
          this.buildGradePayload(id, questions, answerByQuestion),
        ),
      )) as GradedAssessment;

      const resultByQuestion = new Map(
        (grade.questionResults ?? []).map((result) => [
          result.questionId,
          result,
        ]),
      );

      for (const answer of answers) {
        const result = resultByQuestion.get(answer.questionId);
        if (!result) continue;
        answer.score = result.score != null ? String(result.score) : null;
        answer.feedback = result.feedback ?? null;
      }
      if (answers.length) {
        await manager.save(FreelancerAssessmentAnswer, answers);
      }

      const submittedAt = new Date();
      const score = grade.score != null ? String(grade.score) : null;

      locked.status = 'submitted';
      locked.submittedAt = submittedAt;
      locked.score = score;
      locked.aiFeedback = {
        recommendation: grade.recommendation ?? null,
        feedback: grade.feedback ?? null,
        maxScore: grade.maxScore ?? 100,
        profileSummary: grade.profileSummary ?? null,
        questionResults: grade.questionResults ?? [],
        reason: dto.reason ?? 'manual_submit',
      };
      await manager.save(FreelancerAssessment, locked);

      const profile = await manager.findOne(FreelancerProfile, {
        where: { id: locked.freelancerProfileId },
      });
      if (profile) {
        const previousStatus = profile.verificationStatus ?? null;
        const skillScores = this.buildSkillScores({
          assessmentId: locked.id,
          userId,
          freelancerProfileId: profile.id,
          questions,
          results: grade.questionResults ?? [],
          graderConfidence: grade.graderConfidence ?? null,
        });
        if (skillScores.length > 0) {
          await manager.upsert(FreelancerSkillScore, skillScores, [
            'freelancerProfileId',
            'skill',
          ]);
        }

        profile.verificationStatus = 'assessment_submitted';
        profile.assessmentScore = score;
        profile.assessmentSubmittedAt = submittedAt;
        profile.summary = {
          profileSummary:
            grade.profileSummary ??
            this.buildFallbackProfileSummary(grade, skillScores),
          skillRatings: skillScores.map((skillScore) => ({
            skill: skillScore.skill,
            score: Number(skillScore.score),
            confidence:
              skillScore.confidence == null
                ? null
                : Number(skillScore.confidence),
            evidence: skillScore.evidence,
          })),
          assessmentId: locked.id,
          generatedAt: submittedAt.toISOString(),
          overallScore: grade.score ?? null,
          recommendation: grade.recommendation ?? null,
        };
        await manager.save(FreelancerProfile, profile);
        await this.recordVerificationEvent(manager, {
          profile,
          eventType: 'assessment_submitted',
          fromStatus: previousStatus,
          toStatus: profile.verificationStatus,
          actorType: 'freelancer',
          actorUserId: userId,
          metadata: {
            assessmentId: locked.id,
            score,
            recommendation: grade.recommendation ?? null,
          },
        });
      }

      await manager.save(
        Notification,
        manager.create(Notification, {
          userId,
          title: 'Assessment submitted',
          body: 'Your assessment was submitted and is waiting for admin review.',
        }),
      );

      return locked;
    });

    return this.buildSubmitResponse(
      claimed ?? (await this.reloadAssessment(id)),
    );
  }

  // ---------------------------------------------------------------------------
  // Admin: review queue
  // ---------------------------------------------------------------------------

  async adminList(pageNum: number, limitNum: number, status?: string) {
    const [assessments, total] = await this.assessmentRepo.findAndCount({
      where: status ? { status } : {},
      order: { submittedAt: 'DESC', createdAt: 'DESC' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      relations: ['user'],
    });

    const warningCounts = await this.getWarningCounts(
      assessments.map((assessment) => assessment.id),
    );

    const data = assessments.map((assessment) => ({
      id: assessment.id,
      userId: assessment.userId,
      freelancerProfileId: assessment.freelancerProfileId,
      name: this.fullName(assessment.user),
      email: assessment.user?.email ?? null,
      status: assessment.status,
      score: assessment.score,
      durationSeconds: assessment.durationSeconds,
      generatedAt: assessment.generatedAt,
      generationError: assessment.generationError,
      startedAt: assessment.startedAt,
      submittedAt: assessment.submittedAt,
      warningsCount: warningCounts.get(assessment.id) ?? 0,
      createdAt: assessment.createdAt,
    }));

    return { data, total };
  }

  async adminGetById(id: string) {
    const assessment = await this.assessmentRepo.findOne({
      where: { id },
      relations: ['user', 'freelancerProfile'],
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    const questions = await this.questionRepo.find({
      where: { assessmentId: id },
      order: { orderIndex: 'ASC' },
    });
    const answers = await this.getSavedAnswerEntities(id);
    const answerByQuestion = new Map(
      answers.map((answer) => [answer.questionId, answer]),
    );
    const eventsSummary = await this.getEventsSummary(id);
    const profile = assessment.freelancerProfile;

    return {
      assessment: {
        ...this.toAssessmentSummary(assessment),
        aiFeedback: assessment.aiFeedback,
        durationSeconds: assessment.durationSeconds,
        expiresAt: assessment.expiresAt,
      },
      user: {
        id: assessment.user?.id ?? null,
        name: this.fullName(assessment.user),
        email: assessment.user?.email ?? null,
      },
      profile: profile
        ? {
            id: profile.id,
            headline: profile.headline,
            skills: profile.skills,
            yearsExperience: profile.yearsExperience,
            cvUrl: profile.cvUrl,
            cvExtractionStatus: profile.cvExtractionStatus,
            cvExtractedAt: profile.cvExtractedAt,
            cvExtractionError: profile.cvExtractionError,
            verificationStatus: profile.verificationStatus,
          }
        : null,
      cvSummary: profile?.summary ?? null,
      questions: questions.map((question) => ({
        id: question.id,
        questionType: question.questionType,
        skill: question.skill,
        difficulty: question.difficulty,
        prompt: question.prompt,
        choices: question.choices,
        orderIndex: question.orderIndex,
        answer: answerByQuestion.get(question.id)?.answer ?? null,
        score: answerByQuestion.get(question.id)?.score ?? null,
        feedback: answerByQuestion.get(question.id)?.feedback ?? null,
      })),
      eventsSummary,
    };
  }

  async adminReview(id: string, dto: ReviewAssessmentDto, adminUserId: string) {
    const assessment = await this.assessmentRepo.findOne({ where: { id } });
    if (!assessment) throw new NotFoundException('Assessment not found');

    const statusByDecision: Record<string, string> = {
      pass: 'passed',
      fail: 'failed',
      needs_review: 'needs_review',
    };

    return this.dataSource.transaction(async (manager) => {
      assessment.status = statusByDecision[dto.decision];
      if (dto.scoreOverride != null) {
        assessment.score = String(dto.scoreOverride);
      }
      assessment.aiFeedback = {
        ...(assessment.aiFeedback ?? {}),
        adminDecision: dto.decision,
        adminNotes: dto.notes ?? null,
      };
      await manager.save(FreelancerAssessment, assessment);

      const profile = await manager.findOne(FreelancerProfile, {
        where: { id: assessment.freelancerProfileId },
      });
      let notificationBody = 'Your assessment review is complete.';

      if (profile) {
        const previousStatus = profile.verificationStatus ?? null;
        if (dto.decision === 'pass') {
          profile.verificationStatus = 'interview_pending';
          notificationBody =
            'Your assessment passed. You are moving to the interview stage.';
        } else if (dto.decision === 'fail') {
          profile.verificationStatus = 'rejected';
          profile.rejectedAt = new Date();
          profile.rejectionReason = dto.notes ?? null;
          notificationBody = 'Your assessment was not approved after review.';
        }
        await manager.save(FreelancerProfile, profile);
        await this.recordVerificationEvent(manager, {
          profile,
          eventType: 'assessment_reviewed',
          fromStatus: previousStatus,
          toStatus: profile.verificationStatus,
          actorType: 'admin',
          actorUserId: adminUserId,
          metadata: {
            assessmentId: assessment.id,
            decision: dto.decision,
            scoreOverride: dto.scoreOverride ?? null,
          },
        });
      }

      await manager.save(
        Notification,
        manager.create(Notification, {
          userId: assessment.userId,
          title: 'Assessment reviewed',
          body: notificationBody,
        }),
      );

      return {
        id: assessment.id,
        status: assessment.status,
        score: assessment.score,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getProfileWithUser(userId: string) {
    const profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) {
      throw new NotFoundException('Freelancer profile not found');
    }
    return profile;
  }

  private async getLatestAssessment(userId: string, manager?: EntityManager) {
    const repo =
      manager?.getRepository(FreelancerAssessment) ?? this.assessmentRepo;
    return repo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  private getAssessmentStartInputs(profile: FreelancerProfile) {
    if (!profile.cvUrl) {
      throw new BadRequestException(
        'Upload your CV before starting the assessment',
      );
    }

    const skills = (profile.skills ?? []).filter((skill) => skill?.trim());
    if (skills.length === 0) {
      throw new BadRequestException(
        'Wait until your CV is extracted before starting the assessment',
      );
    }

    return { cvUrl: profile.cvUrl, skills };
  }

  private async getOwnedAssessment(userId: string, id: string) {
    const assessment = await this.assessmentRepo.findOne({ where: { id } });
    if (!assessment) throw new NotFoundException('Assessment not found');
    if (assessment.userId !== userId) {
      throw new ForbiddenException('You can only access your own assessment');
    }
    return assessment;
  }

  private async reloadAssessment(id: string) {
    const assessment = await this.assessmentRepo.findOne({ where: { id } });
    if (!assessment) throw new NotFoundException('Assessment not found');
    return assessment;
  }

  private isAssessmentProfileComplete(
    profile: FreelancerProfile,
    skillScoreCount: number,
  ) {
    const summary = profile.summary as
      { profileSummary?: unknown } | null | undefined;
    return Boolean(
      typeof summary?.profileSummary === 'string' &&
      summary.profileSummary.trim() &&
      skillScoreCount > 0,
    );
  }

  private isCvExtracted(profile: FreelancerProfile) {
    return (profile.skills?.length ?? 0) > 0;
  }

  private getMissingProfilePieces(profile: FreelancerProfile): string[] {
    const missing: string[] = [];
    const summary = profile.summary as
      { profileSummary?: unknown; skillRatings?: unknown } | null | undefined;
    if (
      typeof summary?.profileSummary !== 'string' ||
      !summary.profileSummary.trim()
    ) {
      missing.push('assessmentProfileSummary');
    }
    if (
      !Array.isArray(summary?.skillRatings) ||
      summary.skillRatings.length === 0
    ) {
      missing.push('skillRatings');
    }
    return missing;
  }

  private deriveVerification(input: {
    profile: FreelancerProfile;
    latest: FreelancerAssessment | null;
    profileComplete: boolean;
    cvUploaded: boolean;
    emailVerified: boolean;
  }): { verificationStatus: string; nextAction: string } {
    const { profile, latest, cvUploaded, emailVerified } = input;
    const stored = profile.verificationStatus;

    if (stored === 'approved') {
      return { verificationStatus: 'approved', nextAction: 'approved' };
    }
    if (stored === 'rejected') {
      return { verificationStatus: 'rejected', nextAction: 'rejected' };
    }
    if (stored === 'interview_pending') {
      return {
        verificationStatus: 'interview_pending',
        nextAction: 'wait_for_review',
      };
    }

    if (!emailVerified) {
      return {
        verificationStatus: 'email_verification_pending',
        nextAction: 'verify_email',
      };
    }
    if (!cvUploaded) {
      return { verificationStatus: 'cv_pending', nextAction: 'upload_cv' };
    }
    // Skills can come from CV extraction or manual profile entry; matching-only
    // fields like rate and generated summary do not block assessment.
    const hasSkills = (profile.skills?.length ?? 0) > 0;
    if (!hasSkills) {
      if (profile.cvExtractionStatus === 'failed') {
        return {
          verificationStatus: 'cv_pending',
          nextAction: 'upload_cv',
        };
      }
      return {
        verificationStatus: 'cv_processing',
        nextAction: 'wait_for_cv_extraction',
      };
    }

    if (latest) {
      if (latest.status === ACTIVE_STATUS && !this.isExpired(latest)) {
        return {
          verificationStatus: 'assessment_in_progress',
          nextAction: 'continue_assessment',
        };
      }
      if (latest.status === 'ready') {
        return {
          verificationStatus: 'assessment_pending',
          nextAction: 'start_assessment',
        };
      }
      if (latest.status === 'pending' || latest.status === 'generating') {
        return {
          verificationStatus: 'assessment_pending',
          nextAction: 'wait_for_assessment_generation',
        };
      }
      if (SUBMITTED_STATUSES.has(latest.status)) {
        return {
          verificationStatus: 'assessment_submitted',
          nextAction: 'wait_for_review',
        };
      }
    }

    if (
      profile.assessmentGenerationStatus === 'queued' ||
      profile.assessmentGenerationStatus === 'processing'
    ) {
      return {
        verificationStatus: 'assessment_pending',
        nextAction: 'wait_for_assessment_generation',
      };
    }

    if (profile.assessmentGenerationStatus === 'failed') {
      return {
        verificationStatus: 'assessment_pending',
        nextAction: 'retry_assessment_generation',
      };
    }

    return {
      verificationStatus: 'assessment_pending',
      nextAction: 'wait_for_assessment_generation',
    };
  }

  private isExpired(assessment: FreelancerAssessment) {
    return Boolean(
      assessment.expiresAt && assessment.expiresAt.getTime() < Date.now(),
    );
  }

  private remainingSeconds(assessment: FreelancerAssessment) {
    if (!assessment.expiresAt) return assessment.durationSeconds;
    return Math.max(
      0,
      Math.floor((assessment.expiresAt.getTime() - Date.now()) / 1000),
    );
  }

  private toAssessmentSummary(assessment: FreelancerAssessment) {
    return {
      id: assessment.id,
      status: assessment.status,
      score: assessment.score,
      durationSeconds: assessment.durationSeconds,
      startedAt: assessment.startedAt,
      expiresAt: assessment.expiresAt,
      submittedAt: assessment.submittedAt,
    };
  }

  private async getSafeQuestions(assessmentId: string) {
    const questions = await this.questionRepo.find({
      where: { assessmentId },
      order: { orderIndex: 'ASC' },
    });
    return questions.map((question) => ({
      id: question.id,
      questionType: question.questionType,
      skill: question.skill,
      difficulty: question.difficulty,
      prompt: question.prompt,
      choices: question.choices,
      orderIndex: question.orderIndex,
    }));
  }

  private buildStartResponse(
    assessment: FreelancerAssessment,
    questions: Awaited<ReturnType<typeof this.getSafeQuestions>>,
  ) {
    return {
      assessment: {
        id: assessment.id,
        status: assessment.status,
        durationSeconds: assessment.durationSeconds,
        startedAt: assessment.startedAt,
        expiresAt: assessment.expiresAt,
        submittedAt: assessment.submittedAt,
        remainingSeconds: this.remainingSeconds(assessment),
        questionCount: questions.length,
      },
      questions,
      antiCheat: ANTI_CHEAT,
    };
  }

  private async buildDetailResponse(assessment: FreelancerAssessment) {
    const exposeAssessmentContent =
      this.shouldExposeAssessmentContent(assessment);
    const questions = exposeAssessmentContent
      ? await this.getSafeQuestions(assessment.id)
      : [];
    const answers = exposeAssessmentContent
      ? await this.getSavedAnswers(assessment.id)
      : [];
    const eventsSummary = await this.getEventsSummary(assessment.id);

    return {
      assessment: {
        ...this.toAssessmentSummary(assessment),
        remainingSeconds: this.remainingSeconds(assessment),
      },
      questions,
      answers,
      eventsSummary,
      nextAction: this.getAssessmentNextAction(assessment),
    };
  }

  private getAssessmentNextAction(assessment: FreelancerAssessment) {
    if (assessment.status === ACTIVE_STATUS) return 'continue_assessment';
    if (assessment.status === 'ready') return 'start_assessment';
    if (assessment.status === 'pending' || assessment.status === 'generating') {
      return 'wait_for_assessment_generation';
    }
    if (assessment.status === 'generation_failed') {
      return 'retry_assessment_generation';
    }
    if (SUBMITTED_STATUSES.has(assessment.status)) return 'wait_for_review';
    return null;
  }

  private shouldExposeAssessmentContent(assessment: FreelancerAssessment) {
    return (
      assessment.status === ACTIVE_STATUS ||
      SUBMITTED_STATUSES.has(assessment.status) ||
      assessment.status === 'expired' ||
      assessment.status === 'failed'
    );
  }

  private buildSubmitResponse(assessment: FreelancerAssessment) {
    const feedback = assessment.aiFeedback ?? {};
    return {
      assessment: {
        id: assessment.id,
        status: assessment.status,
        score: assessment.score,
        submittedAt: assessment.submittedAt,
      },
      result: {
        recommendation: feedback.recommendation ?? null,
        feedback: feedback.feedback ?? null,
        questionResults: feedback.questionResults ?? [],
      },
      nextAction: 'wait_for_review',
    };
  }

  private async upsertAnswers(
    assessmentId: string,
    answers: { questionId: string; answer: Record<string, unknown> }[],
    manager?: EntityManager,
  ) {
    const questionRepo =
      manager?.getRepository(FreelancerAssessmentQuestion) ?? this.questionRepo;
    const answerRepo =
      manager?.getRepository(FreelancerAssessmentAnswer) ?? this.answerRepo;
    const validQuestionIds = new Set(
      (
        await questionRepo.find({
          where: { assessmentId },
          select: { id: true },
        })
      ).map((question) => question.id),
    );

    const rows = answers
      .filter((answer) => validQuestionIds.has(answer.questionId))
      .map((answer) => ({
        assessmentId,
        questionId: answer.questionId,
        answer: answer.answer,
        updatedAt: new Date(),
      }));

    if (rows.length !== answers.length) {
      throw new BadRequestException(
        'One or more answers reference a question outside this assessment',
      );
    }
    if (rows.length === 0) return;

    await answerRepo.upsert(
      rows as QueryDeepPartialEntity<FreelancerAssessmentAnswer>[],
      ['assessmentId', 'questionId'],
    );
  }

  private async getSavedAnswerEntities(assessmentId: string) {
    return this.answerRepo.find({
      where: { assessmentId },
      order: { updatedAt: 'ASC' },
    });
  }

  private async getSavedAnswers(assessmentId: string) {
    const answers = await this.getSavedAnswerEntities(assessmentId);
    return answers.map((answer) => ({
      questionId: answer.questionId,
      answer: answer.answer,
      updatedAt: answer.updatedAt,
    }));
  }

  private buildGradePayload(
    assessmentId: string,
    questions: FreelancerAssessmentQuestion[],
    answerByQuestion: Map<string, FreelancerAssessmentAnswer>,
  ) {
    return {
      assessmentId,
      questions: questions.map((question) => ({
        id: question.id,
        questionType: question.questionType,
        skill: question.skill,
        difficulty: question.difficulty,
        prompt: question.prompt,
        choices: this.normalizeChoicesForAi(question.choices),
        rubric: this.normalizeRubricForAi(question.rubric),
      })),
      answers: questions.map((question) => ({
        questionId: question.id,
        answer: this.normalizeAnswerForAi(
          answerByQuestion.get(question.id)?.answer,
        ),
      })),
    };
  }

  private async getEventsSummary(assessmentId: string) {
    const events = await this.eventRepo.find({ where: { assessmentId } });
    const byType: Record<string, number> = {};
    for (const event of events) {
      byType[event.eventType] = (byType[event.eventType] ?? 0) + 1;
    }
    return {
      total: events.length,
      focusLost: byType['focus_lost'] ?? 0,
      fullscreenExit: byType['fullscreen_exit'] ?? 0,
      byType,
    };
  }

  private async getWarningCounts(assessmentIds: string[]) {
    const counts = new Map<string, number>();
    if (assessmentIds.length === 0) return counts;

    const rows = await this.eventRepo
      .createQueryBuilder('event')
      .select('event.assessment_id', 'assessmentId')
      .addSelect('COUNT(*)', 'count')
      .where('event.assessment_id IN (:...ids)', { ids: assessmentIds })
      .andWhere('event.event_type IN (:...types)', {
        types: WARNING_EVENT_TYPES,
      })
      .groupBy('event.assessment_id')
      .getRawMany<{ assessmentId: string; count: string }>();

    for (const row of rows) {
      counts.set(row.assessmentId, Number(row.count));
    }
    return counts;
  }

  private async getWarningCount(assessmentId: string, manager?: EntityManager) {
    const repo =
      manager?.getRepository(FreelancerAssessmentEvent) ?? this.eventRepo;
    return repo
      .createQueryBuilder('event')
      .where('event.assessment_id = :assessmentId', { assessmentId })
      .andWhere('event.event_type IN (:...types)', {
        types: WARNING_EVENT_TYPES,
      })
      .getCount();
  }

  private buildSkillScores(input: {
    assessmentId: string;
    userId: string;
    freelancerProfileId: string;
    questions: FreelancerAssessmentQuestion[];
    results: GradedQuestionResult[];
    graderConfidence: number | null;
  }) {
    const questionById = new Map(
      input.questions.map((question) => [question.id, question]),
    );
    const grouped = new Map<
      string,
      { scores: number[]; feedback: string[]; count: number }
    >();

    for (const result of input.results) {
      const question = questionById.get(result.questionId);
      if (!question) continue;
      const skill = question.skill?.trim();
      if (!skill) continue;

      const maxScore =
        result.maxScore ??
        (typeof question.rubric?.maxScore === 'number'
          ? question.rubric.maxScore
          : 100);
      if (!maxScore || maxScore <= 0 || result.score == null) continue;

      const scoreOutOfFive = Math.max(
        0,
        Math.min(5, (result.score / maxScore) * 5),
      );
      const bucket = grouped.get(skill) ?? {
        scores: [],
        feedback: [],
        count: 0,
      };
      bucket.scores.push(scoreOutOfFive);
      bucket.count += 1;
      if (result.feedback) bucket.feedback.push(result.feedback);
      grouped.set(skill, bucket);
    }

    return Array.from(grouped.entries()).map(([skill, bucket]) => {
      const average =
        bucket.scores.reduce((sum, score) => sum + score, 0) /
        bucket.scores.length;
      return {
        freelancerProfileId: input.freelancerProfileId,
        userId: input.userId,
        assessmentId: input.assessmentId,
        skill: skill.slice(0, 120),
        score: average.toFixed(2),
        confidence:
          input.graderConfidence == null
            ? null
            : Math.max(0, Math.min(1, input.graderConfidence)).toFixed(2),
        evidence: bucket.feedback.slice(0, 3).join(' '),
        source: 'assessment',
        updatedAt: new Date(),
      };
    });
  }

  private buildFallbackProfileSummary(
    grade: GradedAssessment,
    skillScores: { skill: string; score: string; evidence: string | null }[],
  ) {
    const skills = skillScores
      .slice()
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, 8)
      .map((skillScore) => `${skillScore.skill} (${skillScore.score}/5)`)
      .join(', ');

    return [
      grade.feedback ?? 'Assessment completed and graded.',
      skills ? `Skill signals: ${skills}.` : null,
      grade.recommendation
        ? `Recommendation: ${grade.recommendation.replace(/_/g, ' ')}.`
        : null,
    ]
      .filter(Boolean)
      .join(' ');
  }

  private normalizeChoicesForAi(
    choices: FreelancerAssessmentQuestion['choices'],
  ) {
    if (!Array.isArray(choices)) return null;
    return choices
      .map((choice) => {
        if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
          return null;
        }
        const item = choice as Record<string, unknown>;
        if (typeof item.id !== 'string' || typeof item.label !== 'string') {
          return null;
        }
        return { id: item.id, label: item.label };
      })
      .filter(Boolean);
  }

  private normalizeRubricForAi(rubric: Record<string, unknown> | null) {
    const maxScore =
      typeof rubric?.maxScore === 'number' && Number.isFinite(rubric.maxScore)
        ? rubric.maxScore
        : 100;
    return {
      maxScore,
      gradingNotes:
        typeof rubric?.gradingNotes === 'string' && rubric.gradingNotes.trim()
          ? rubric.gradingNotes
          : 'Grade the answer for practical correctness, reasoning, and clarity.',
      correctChoiceId:
        typeof rubric?.correctChoiceId === 'string'
          ? rubric.correctChoiceId
          : null,
    };
  }

  private normalizeAnswerForAi(answer: unknown) {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      return {};
    }

    const value = answer as Record<string, unknown>;
    if (typeof value.choiceId === 'string' && value.choiceId.trim()) {
      return { choiceId: value.choiceId.trim() };
    }
    if (typeof value.value === 'string' && value.value.trim()) {
      return { value: value.value.trim() };
    }
    return {};
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

  private fullName(user?: { firstName?: string; lastName?: string } | null) {
    if (!user) return null;
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  }
}
