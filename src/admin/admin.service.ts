import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { Project } from 'src/projects/entities/project.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { FreelancerAssessment } from 'src/freelancers/entities/freelancer-assessment.entity';
import { FreelancerAssessmentQuestion } from 'src/freelancers/entities/freelancer-assessment-question.entity';
import { FreelancerAssessmentAnswer } from 'src/freelancers/entities/freelancer-assessment-answer.entity';
import { FreelancerAssessmentEvent } from 'src/freelancers/entities/freelancer-assessment-event.entity';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { UserRole } from 'src/common/enums/user-role.enum';
import { ProjectStatus } from 'src/common/enums/project-status.enum';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectRepository(Project) private projectRepository: Repository<Project>,
    @InjectRepository(FreelancerProfile) private freelancerProfileRepository: Repository<FreelancerProfile>,
    @InjectRepository(FreelancerAssessment) private assessmentRepository: Repository<FreelancerAssessment>,
    @InjectRepository(FreelancerAssessmentQuestion) private questionRepository: Repository<FreelancerAssessmentQuestion>,
    @InjectRepository(FreelancerAssessmentAnswer) private answerRepository: Repository<FreelancerAssessmentAnswer>,
    @InjectRepository(FreelancerAssessmentEvent) private eventRepository: Repository<FreelancerAssessmentEvent>,
    @InjectRepository(AgentJob) private agentJobRepository: Repository<AgentJob>,
  ) {}

  // ===== Users =====

  async getUsers(pageNum: number, limitNum: number) {
    const [users, total] = await this.userRepository.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        isEmailVerified: true,
        isIdVerified: true,
        photoUrl: true,
        role: true,
        createdAt: true,
      },
    });
    return { users, total };
  }

  // ===== Projects =====

  async getProjects(pageNum: number, limitNum: number) {
    const [projects, total] = await this.projectRepository.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      relations: ['customer'],
      select: {
        id: true,
        title: true,
        description: true,
        budgetMin: true,
        budgetMax: true,
        currency: true,
        deadline: true,
        status: true,
        createdAt: true,
        customer: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
        },
      },
    });
    return { projects, total };
  }

  // ===== Stats =====

  async getStats() {
    // 1. Users
    const userStats = {
      total: await this.userRepository.count(),
      customers: await this.userRepository.count({ where: { role: UserRole.CUSTOMER } }),
      freelancers: await this.userRepository.count({ where: { role: UserRole.FREELANCER } }),
      admins: await this.userRepository.count({ where: { role: UserRole.ADMIN } }),
      emailVerified: await this.userRepository.count({ where: { isEmailVerified: true } }),
      emailPending: await this.userRepository.count({ where: { isEmailVerified: false } }),
    };

    // 2. Projects
    const projectStats = {
      total: await this.projectRepository.count(),
      draft: await this.projectRepository.count({ where: { status: ProjectStatus.DRAFT } }),
      briefComplete: await this.projectRepository.count({ where: { status: ProjectStatus.BRIEF_COMPLETE } }),
      assigned: await this.projectRepository.count({ where: { status: ProjectStatus.ASSIGNED } }),
      active: await this.projectRepository.count({ where: { status: ProjectStatus.ACTIVE } }),
      completed: await this.projectRepository.count({ where: { status: ProjectStatus.COMPLETED } }),
    };

    // 3. Freelancers by verification status
    const freelancerStatuses = await this.freelancerProfileRepository
      .createQueryBuilder('fp')
      .select('fp.verificationStatus, COUNT(*) as count')
      .groupBy('fp.verificationStatus')
      .getRawMany();

    const freelancerStats = {
      total: await this.freelancerProfileRepository.count(),
      profileIncomplete: 0,
      cvPending: 0,
      assessmentPending: 0,
      assessmentInProgress: 0,
      assessmentSubmitted: 0,
      approved: 0,
      rejected: 0,
    };

    freelancerStatuses.forEach((row) => {
      const key = row.fp_verificationStatus;
      const count = parseInt(row.count, 10);
      if (key === 'profile_incomplete') freelancerStats.profileIncomplete = count;
      else if (key === 'cv_pending') freelancerStats.cvPending = count;
      else if (key === 'assessment_pending') freelancerStats.assessmentPending = count;
      else if (key === 'assessment_in_progress') freelancerStats.assessmentInProgress = count;
      else if (key === 'assessment_submitted') freelancerStats.assessmentSubmitted = count;
      else if (key === 'approved') freelancerStats.approved = count;
      else if (key === 'rejected') freelancerStats.rejected = count;
    });

    // 4. Assessments
    const assessmentStats = {
      total: await this.assessmentRepository.count(),
      inProgress: await this.assessmentRepository.count({ where: { status: 'in_progress' } }),
      submitted: await this.assessmentRepository.count({ where: { status: 'submitted' } }),
      passed: await this.assessmentRepository.count({ where: { status: 'passed' } }),
      failed: await this.assessmentRepository.count({ where: { status: 'failed' } }),
      needsReview: await this.assessmentRepository.count({ where: { status: 'needs_review' } }),
    };

    // 5. Agent jobs
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const agentTotals = {
      queued: await this.agentJobRepository.count({ where: { status: 'queued' } }),
      running: await this.agentJobRepository.count({ where: { status: 'running' } }),
      completedToday: 0,
      failedToday: 0,
      healthy: 3,
      failing: 1,
    };

    const completedToday = await this.agentJobRepository
      .createQueryBuilder('job')
      .where('job.status = :status', { status: 'completed' })
      .andWhere('job.completedAt >= :today', { today })
      .getCount();

    const failedToday = await this.agentJobRepository
      .createQueryBuilder('job')
      .where('job.status = :status', { status: 'failed' })
      .andWhere('job.failedAt >= :today', { today })
      .getCount();

    agentTotals.completedToday = completedToday;
    agentTotals.failedToday = failedToday;

    return {
      users: userStats,
      projects: projectStats,
      freelancers: freelancerStats,
      assessments: assessmentStats,
      agents: {
        ...agentTotals,
        healthy: 3,
        failing: 1,
      },
    };
  }

  // ===== Freelancer Queue =====

  async getFreelancers(
    pageNum: number,
    limitNum: number,
    status?: string,
    search?: string,
    skills?: string[],
    dateFrom?: string,
    dateTo?: string,
  ) {
    const query = this.freelancerProfileRepository
      .createQueryBuilder('fp')
      .leftJoinAndSelect('fp.user', 'user')
      .orderBy('fp.createdAt', 'DESC')
      .skip((pageNum - 1) * limitNum)
      .take(limitNum);

    if (status) {
      query.andWhere('fp.verificationStatus = :status', { status });
    }
    if (search) {
      query.andWhere(
        '(user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.email ILIKE :search)',
        { search: `%${search}%` },
      );
    }
    if (skills && skills.length > 0) {
      query.andWhere('fp.skills && :skills', { skills });
    }
    if (dateFrom) {
      query.andWhere('fp.assessmentSubmittedAt >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      query.andWhere('fp.assessmentSubmittedAt <= :dateTo', { dateTo });
    }

    const [profiles, total] = await query.getManyAndCount();

    const data = profiles.map((profile) => ({
      id: profile.id,
      userId: profile.user.id,
      name: `${profile.user.firstName} ${profile.user.lastName}`,
      email: profile.user.email,
      headline: profile.headline,
      skills: profile.skills,
      yearsExperience: profile.yearsExperience,
      cvUrl: profile.cvUrl,
      verificationStatus: profile.verificationStatus,
      assessmentScore: profile.assessmentScore,
      assessmentSubmittedAt: profile.assessmentSubmittedAt,
      createdAt: profile.createdAt,
    }));

    return { data, total };
  }

  async getFreelancerDetail(id: string) {
    const profile = await this.freelancerProfileRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!profile) {
      throw new Error('Freelancer profile not found');
    }

    const assessment = await this.assessmentRepository.findOne({
      where: { freelancerProfileId: id },
      order: { createdAt: 'DESC' },
    });

    let questions: any[] = [];
    let answers: any[] = [];
    if (assessment) {
      questions = await this.questionRepository.find({
        where: { assessmentId: assessment.id },
        order: { orderIndex: 'ASC' },
      });
      answers = await this.answerRepository.find({
        where: { assessmentId: assessment.id },
      });
    }

    return {
      profile: {
        id: profile.id,
        userId: profile.user.id,
        name: `${profile.user.firstName} ${profile.user.lastName}`,
        email: profile.user.email,
        headline: profile.headline,
        bio: profile.bio,
        skills: profile.skills,
        yearsExperience: profile.yearsExperience,
        hourlyRate: profile.hourlyRate,
        cvUrl: profile.cvUrl,
        verificationStatus: profile.verificationStatus,
        assessmentScore: profile.assessmentScore,
        assessmentSubmittedAt: profile.assessmentSubmittedAt,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      assessment: assessment
        ? {
            id: assessment.id,
            status: assessment.status,
            score: assessment.score,
            submittedAt: assessment.submittedAt,
            startedAt: assessment.startedAt,
            expiresAt: assessment.expiresAt,
            questions,
            answers,
          }
        : null,
    };
  }

  async updateFreelancerVerification(id: string, payload: { status: string; reason?: string }) {
    const profile = await this.freelancerProfileRepository.findOne({
      where: { id },
    });

    if (!profile) {
      throw new Error('Freelancer profile not found');
    }

    profile.verificationStatus = payload.status;
    if (payload.status === 'approved') {
      profile.approvedAt = new Date();
    } else if (payload.status === 'rejected') {
      profile.rejectedAt = new Date();
      profile.rejectionReason = payload.reason || 'No reason provided';
    }

    await this.freelancerProfileRepository.save(profile);

    // TODO: Create notification for freelancer

    return profile;
  }

  // ===== Assessment Review =====

  async getAssessments(
    pageNum: number,
    limitNum: number,
    status?: string,
    search?: string,
    dateFrom?: string,
    dateTo?: string,
    minScore?: number,
    maxScore?: number,
  ) {
    const query = this.assessmentRepository
      .createQueryBuilder('a')
      .leftJoin('a.freelancerProfile', 'fp')
      .leftJoin('fp.user', 'user')
      .orderBy('a.submittedAt', 'DESC')
      .skip((pageNum - 1) * limitNum)
      .take(limitNum);

    if (status) {
      query.andWhere('a.status = :status', { status });
    }
    if (search) {
      query.andWhere(
        '(user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.email ILIKE :search)',
        { search: `%${search}%` },
      );
    }
    if (dateFrom) {
      query.andWhere('a.submittedAt >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      query.andWhere('a.submittedAt <= :dateTo', { dateTo });
    }
    if (minScore !== undefined && minScore !== null) {
      query.andWhere('a.score >= :minScore', { minScore });
    }
    if (maxScore !== undefined && maxScore !== null) {
      query.andWhere('a.score <= :maxScore', { maxScore });
    }

    const [assessments, total] = await query.getManyAndCount();

    const data = assessments.map((a) => ({
      id: a.id,
      freelancerName: `${a.freelancerProfile.user.firstName} ${a.freelancerProfile.user.lastName}`,
      freelancerEmail: a.freelancerProfile.user.email,
      score: a.score,
      status: a.status,
      recommendation: a.aiFeedback?.decision || null,
      warningCount: 0,
      submittedAt: a.submittedAt,
      startedAt: a.startedAt,
    }));

    return { data, total };
  }

  async getAssessmentDetail(id: string) {
    const assessment = await this.assessmentRepository.findOne({
      where: { id },
      relations: ['freelancerProfile', 'freelancerProfile.user'],
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    const questions = await this.questionRepository.find({
      where: { assessmentId: id },
      order: { orderIndex: 'ASC' },
    });

    const answers = await this.answerRepository.find({
      where: { assessmentId: id },
    });

    const events = await this.eventRepository.find({
      where: { assessmentId: id },
    });

    const eventSummary = {
      total: events.length,
      focusLost: events.filter((e) => e.eventType === 'focus_lost').length,
      fullscreenExit: events.filter((e) => e.eventType === 'fullscreen_exit').length,
    };

    return {
      id: assessment.id,
      freelancer: {
        id: assessment.freelancerProfile.id,
        name: `${assessment.freelancerProfile.user.firstName} ${assessment.freelancerProfile.user.lastName}`,
        email: assessment.freelancerProfile.user.email,
        headline: assessment.freelancerProfile.headline,
      },
      status: assessment.status,
      score: assessment.score,
      recommendation: assessment.aiFeedback?.decision || null,
      submittedAt: assessment.submittedAt,
      startedAt: assessment.startedAt,
      expiresAt: assessment.expiresAt,
      questions: questions.map((q) => {
        const ans = answers.find((a) => a.questionId === q.id);
        return {
          id: q.id,
          type: q.questionType,
          skill: q.skill,
          prompt: q.prompt,
          orderIndex: q.orderIndex,
          answer: ans?.answer || null,
          score: ans?.score || null,
          feedback: ans?.feedback || null,
        };
      }),
      eventsSummary: eventSummary,
    };
  }

  async reviewAssessment(
    id: string,
    payload: { decision: 'pass' | 'fail' | 'needs_review'; notes?: string; scoreOverride?: number },
  ) {
    const assessment = await this.assessmentRepository.findOne({
      where: { id },
      relations: ['freelancerProfile'],
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    if (assessment.status !== 'submitted' && assessment.status !== 'needs_review') {
      throw new Error('Assessment is not in a reviewable state');
    }

    // Update assessment
    assessment.status = payload.decision === 'pass' ? 'passed' : payload.decision === 'fail' ? 'failed' : 'needs_review';
    if (payload.scoreOverride !== undefined && payload.scoreOverride !== null) {
      assessment.score = String(payload.scoreOverride); // cast to string
    }

    // Store decision and notes in aiFeedback
    assessment.aiFeedback = {
      ...(assessment.aiFeedback || {}),
      decision: payload.decision,
      notes: payload.notes,
      reviewedAt: new Date(),
    };

    await this.assessmentRepository.save(assessment);

    // Update freelancer verification status based on decision
    if (payload.decision === 'pass') {
      const profile = await this.freelancerProfileRepository.findOne({
        where: { id: assessment.freelancerProfile.id },
      });
      if (profile) {
        profile.verificationStatus = 'approved';
        profile.approvedAt = new Date();
        await this.freelancerProfileRepository.save(profile);
      }
    } else if (payload.decision === 'fail') {
      const profile = await this.freelancerProfileRepository.findOne({
        where: { id: assessment.freelancerProfile.id },
      });
      if (profile) {
        profile.verificationStatus = 'rejected';
        profile.rejectedAt = new Date();
        profile.rejectionReason = payload.notes || 'Assessment failed review';
        await this.freelancerProfileRepository.save(profile);
      }
    }

    // TODO: Create notification for freelancer

    return { id: assessment.id, status: assessment.status };
  }

  // ===== Agent Overview =====

  async getAgentOverview() {
    const agentTypes = [
      'requirements',
      'cv_extraction',
      'assessment_generation',
      'assessment_grading',
      'matching',
      'evaluation',
    ];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const agents = await Promise.all(
      agentTypes.map(async (name) => {
        const queued = await this.agentJobRepository.count({
          where: { jobType: name, status: 'queued' },
        });
        const running = await this.agentJobRepository.count({
          where: { jobType: name, status: 'running' },
        });

        const completedToday = await this.agentJobRepository
          .createQueryBuilder('job')
          .where('job.jobType = :jobType', { jobType: name })
          .andWhere('job.status = :status', { status: 'completed' })
          .andWhere('job.completedAt >= :today', { today })
          .getCount();

        const failedToday = await this.agentJobRepository
          .createQueryBuilder('job')
          .where('job.jobType = :jobType', { jobType: name })
          .andWhere('job.status = :status', { status: 'failed' })
          .andWhere('job.failedAt >= :today', { today })
          .getCount();

        const lastSuccess = await this.agentJobRepository.findOne({
          where: { jobType: name, status: 'completed' },
          order: { completedAt: 'DESC' },
          select: ['completedAt'],
        });

        const lastFailure = await this.agentJobRepository.findOne({
          where: { jobType: name, status: 'failed' },
          order: { failedAt: 'DESC' },
          select: ['failedAt'],
        });

        let health = 'healthy';
        if (failedToday > 2) health = 'failing';
        else if (failedToday > 0) health = 'degraded';

        return {
          name,
          status: health,
          queued,
          running,
          completedToday,
          failedToday,
          lastSuccessAt: lastSuccess?.completedAt || null,
          lastFailureAt: lastFailure?.failedAt || null,
        };
      })
    );

    const totals = {
      queued: await this.agentJobRepository.count({ where: { status: 'queued' } }),
      running: await this.agentJobRepository.count({ where: { status: 'running' } }),
      completedToday: await this.agentJobRepository
        .createQueryBuilder('job')
        .where('job.status = :status', { status: 'completed' })
        .andWhere('job.completedAt >= :today', { today })
        .getCount(),
      failedToday: await this.agentJobRepository
        .createQueryBuilder('job')
        .where('job.status = :status', { status: 'failed' })
        .andWhere('job.failedAt >= :today', { today })
        .getCount(),
    };

    return { agents, totals };
  }

  // ===== Agent Jobs =====

  async getAgentJobs(pageNum: number, limitNum: number, status?: string, jobType?: string) {
    const query = this.agentJobRepository
      .createQueryBuilder('job')
      .orderBy('job.createdAt', 'DESC')
      .skip((pageNum - 1) * limitNum)
      .take(limitNum);

    if (status) {
      query.where('job.status = :status', { status });
    }
    if (jobType) {
      query.andWhere('job.jobType = :jobType', { jobType });
    }

    const [jobs, total] = await query.getManyAndCount();

    const data = jobs.map((job) => ({
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      userId: null,
      projectId: job.projectId,
      targetType: job.taskId ? 'task' : job.briefId ? 'brief' : job.submissionId ? 'submission' : job.matchingRunId ? 'matching_run' : null,
      targetId: job.taskId || job.briefId || job.submissionId || job.matchingRunId || null,
      payload: job.input,
      result: job.output,
      error: job.error,
      attempts: job.attempts,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    }));

    return { data, total };
  }

  async getAgentJobDetail(id: string) {
    const job = await this.agentJobRepository.findOne({
      where: { id },
    });

    if (!job) {
      throw new Error('Agent job not found');
    }

    return {
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      userId: null,
      projectId: job.projectId,
      targetType: job.taskId ? 'task' : job.briefId ? 'brief' : job.submissionId ? 'submission' : job.matchingRunId ? 'matching_run' : null,
      targetId: job.taskId || job.briefId || job.submissionId || job.matchingRunId || null,
      payload: job.input,
      result: job.output,
      error: job.error,
      attempts: job.attempts,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }
}