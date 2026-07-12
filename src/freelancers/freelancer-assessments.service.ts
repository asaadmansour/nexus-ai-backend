import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AiService } from 'src/agents/ai.service';
import { Notification } from 'src/notifications/entities/notification.entity';
import { ReviewAssessmentDto } from 'src/admin/dtos/review-assessment.dto';
import { FreelancerAssessment } from './entities/freelancer-assessment.entity';
import { FreelancerAssessmentAnswer } from './entities/freelancer-assessment-answer.entity';
import { FreelancerAssessmentEvent } from './entities/freelancer-assessment-event.entity';
import { FreelancerAssessmentQuestion } from './entities/freelancer-assessment-question.entity';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { StartAssessmentDto } from './dtos/start-assessment.dto';
import { SaveAssessmentAnswersDto } from './dtos/save-assessment-answers.dto';
import { SubmitAssessmentDto } from './dtos/submit-assessment.dto';
import { TrackAssessmentEventDto } from './dtos/track-assessment-event.dto';

const DEFAULT_QUESTION_COUNT = 6;
const DEFAULT_DURATION_SECONDS = 1800;
const ACTIVE_STATUS = 'in_progress';
const SUBMITTED_STATUSES = new Set([
  'submitted',
  'graded',
  'needs_review',
  'passed',
  'failed',
]);
const WARNING_EVENT_TYPES = [
  'focus_lost',
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

interface GradedQuestionResult {
  questionId: string;
  score?: number;
  feedback?: string;
}

interface GradedAssessment {
  score?: number;
  maxScore?: number;
  recommendation?: string;
  feedback?: string;
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
    private readonly aiService: AiService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Freelancer: verification checklist
  // ---------------------------------------------------------------------------

  async getVerification(userId: string, emailVerified: boolean) {
    const profile = await this.getProfileWithUser(userId);
    const latest = await this.getLatestAssessment(userId);

    const profileComplete = this.isProfileComplete(profile);
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
      nextAction,
      assessment: latest ? this.toAssessmentSummary(latest) : null,
      missing,
    };
  }

  // ---------------------------------------------------------------------------
  // Freelancer: start / reuse assessment
  // ---------------------------------------------------------------------------

  async start(userId: string, dto: StartAssessmentDto) {
    const profile = await this.getProfileWithUser(userId);

    if (!profile.cvUrl) {
      throw new BadRequestException(
        'Upload your CV before starting the assessment',
      );
    }

    const skills = (profile.skills ?? []).filter((skill) => skill?.trim());
    if (skills.length === 0) {
      throw new BadRequestException(
        'Add at least one skill to your profile before starting the assessment',
      );
    }

    const latest = await this.getLatestAssessment(userId);

    if (latest && latest.status === ACTIVE_STATUS) {
      if (!this.isExpired(latest)) {
        const questions = await this.getSafeQuestions(latest.id);
        return this.buildStartResponse(latest, questions);
      }
      latest.status = 'expired';
      await this.assessmentRepo.save(latest);
    }

    if (latest && SUBMITTED_STATUSES.has(latest.status)) {
      throw new ConflictException(
        'Your latest assessment is already submitted and waiting for review',
      );
    }

    const questionCount = dto.questionCount ?? DEFAULT_QUESTION_COUNT;
    const durationSeconds = dto.durationSeconds ?? DEFAULT_DURATION_SECONDS;

    // AiService currently returns mock data synchronously; wrap so this keeps
    // working once Muhanad swaps in the async FastAPI-backed client.
    const generated = (await Promise.resolve(
      this.aiService.generateAssessment({
        cvUrl: profile.cvUrl,
        skills,
        yearsExperience: profile.yearsExperience ?? undefined,
        headline: profile.headline ?? undefined,
        questionCount,
        durationSeconds,
      }),
    )) as GeneratedAssessment;

    if (!generated?.questions?.length) {
      throw new BadRequestException(
        'The assessment generator did not return any questions. Please try again.',
      );
    }

    const finalDuration = generated.durationSeconds ?? durationSeconds;
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + finalDuration * 1000);

    const created = await this.dataSource.transaction(async (manager) => {
      const assessment = await manager.save(
        FreelancerAssessment,
        manager.create(FreelancerAssessment, {
          userId,
          freelancerProfileId: profile.id,
          status: ACTIVE_STATUS,
          durationSeconds: finalDuration,
          startedAt,
          expiresAt,
          submittedAt: null,
          generatedFromCvUrl: profile.cvUrl,
        }),
      );

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

      profile.verificationStatus = 'assessment_in_progress';
      await manager.save(FreelancerProfile, profile);

      return assessment;
    });

    const safeQuestions = await this.getSafeQuestions(created.id);
    return this.buildStartResponse(created, safeQuestions);
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
    const assessment = await this.getOwnedAssessment(userId, id);

    const event = await this.eventRepo.save(
      this.eventRepo.create({
        assessmentId: assessment.id,
        eventType: dto.eventType,
        metadata: dto.metadata ?? null,
      }),
    );

    return {
      id: event.id,
      eventType: event.eventType,
      createdAt: event.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Freelancer: submit + grade
  // ---------------------------------------------------------------------------

  async submit(userId: string, id: string, dto: SubmitAssessmentDto) {
    const owned = await this.getOwnedAssessment(userId, id);

    if (owned.status !== ACTIVE_STATUS) {
      return this.buildSubmitResponse(await this.reloadAssessment(id));
    }

    if (dto.finalAnswers?.length) {
      await this.upsertAnswers(id, dto.finalAnswers);
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
        questionResults: grade.questionResults ?? [],
        reason: dto.reason ?? 'manual_submit',
      };
      await manager.save(FreelancerAssessment, locked);

      const profile = await manager.findOne(FreelancerProfile, {
        where: { id: locked.freelancerProfileId },
      });
      if (profile) {
        profile.verificationStatus = 'assessment_submitted';
        profile.assessmentScore = score;
        profile.assessmentSubmittedAt = submittedAt;
        await manager.save(FreelancerProfile, profile);
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

  async adminReview(id: string, dto: ReviewAssessmentDto) {
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

  private async getLatestAssessment(userId: string) {
    return this.assessmentRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
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

  private isProfileComplete(profile: FreelancerProfile) {
    return Boolean(
      profile.headline &&
      profile.bio &&
      (profile.skills?.length ?? 0) > 0 &&
      profile.yearsExperience != null &&
      profile.hourlyRate != null &&
      profile.cvUrl,
    );
  }

  private isCvExtracted(profile: FreelancerProfile) {
    return Boolean(profile.summary && Object.keys(profile.summary).length > 0);
  }

  private getMissingProfilePieces(profile: FreelancerProfile): string[] {
    const missing: string[] = [];
    if (!profile.headline) missing.push('headline');
    if (!profile.bio) missing.push('bio');
    if ((profile.skills?.length ?? 0) === 0) missing.push('skills');
    if (profile.yearsExperience == null) missing.push('yearsExperience');
    if (profile.hourlyRate == null) missing.push('hourlyRate');
    if (!profile.cvUrl) missing.push('cvUrl');
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
    // Profile fields (headline/bio/rate/years) no longer block the assessment —
    // it only needs a CV plus extracted skills, so the freelancer can take it first.
    const hasSkills = (profile.skills?.length ?? 0) > 0;
    if (!hasSkills) {
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
      if (SUBMITTED_STATUSES.has(latest.status)) {
        return {
          verificationStatus: 'assessment_submitted',
          nextAction: 'wait_for_review',
        };
      }
    }

    return {
      verificationStatus: 'assessment_pending',
      nextAction: 'start_assessment',
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
    const questions = await this.getSafeQuestions(assessment.id);
    const answers = await this.getSavedAnswers(assessment.id);
    const eventsSummary = await this.getEventsSummary(assessment.id);
    const nextAction =
      assessment.status === ACTIVE_STATUS
        ? 'continue_assessment'
        : SUBMITTED_STATUSES.has(assessment.status)
          ? 'wait_for_review'
          : null;

    return {
      assessment: {
        ...this.toAssessmentSummary(assessment),
        remainingSeconds: this.remainingSeconds(assessment),
      },
      questions,
      answers,
      eventsSummary,
      nextAction,
    };
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
  ) {
    const validQuestionIds = new Set(
      (
        await this.questionRepo.find({
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

    await this.answerRepo.upsert(
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
      answers: questions.map((question) => ({
        questionId: question.id,
        answer: answerByQuestion.get(question.id)?.answer ?? {},
        question: {
          questionType: question.questionType,
          skill: question.skill,
          difficulty: question.difficulty,
          prompt: question.prompt,
          choices: question.choices,
          rubric: question.rubric,
        },
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

  private normalizeChoices(
    choices: GeneratedQuestion['choices'],
  ): Record<string, unknown> | null {
    if (!choices) return null;
    return choices as Record<string, unknown>;
  }

  private fullName(user?: { firstName?: string; lastName?: string } | null) {
    if (!user) return null;
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  }
}
