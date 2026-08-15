export const QUEUES = {
  CV_EXTRACTION: 'cv-extraction',
  ASSESSMENT_GENERATION: 'assessment-generation',
  ASSESSMENT_GRADING: 'assessment-grading',
  PROFILE_EMBEDDING: 'profile-embedding',
  PROJECT_PLAN_GENERATION: 'project-plan-generation',
  PLANNING_SUBMISSION_EVALUATION: 'planning-submission-evaluation',
  SUBMISSION_EVALUATION: 'submission-evaluation',
} as const;

export const JOBS = {
  EXTRACT_CV: 'extract-cv',
  GENERATE_ASSESSMENT: 'generate-assessment',
  GRADE_ASSESSMENT: 'grade-assessment',
  GENERATE_PROFILE_EMBEDDING: 'generate-profile-embedding',
  GENERATE_PROJECT_PLAN: 'generate-project-plan',
  EVALUATE_PLANNING_SUBMISSION: 'evaluate-planning-submission',
  EVALUATE_SUBMISSION: 'evaluate-submission',
} as const;

export const AI_JOB_TYPES = {
  CV_EXTRACTION: 'cv_extraction',
  ASSESSMENT_GENERATION: 'assessment_generation',
  PROFILE_EMBEDDING: 'profile_embedding',
  PROJECT_PLAN_GENERATION: 'project_plan_generation',
  PLANNING_SUBMISSION_EVALUATION: 'planning_submission_evaluation',
  SUBMISSION_EVALUATION: 'submission_evaluation',
} as const;

export const AI_JOB_RETRY = {
  ATTEMPTS: 3,
  BACKOFF_DELAY_MS: 5000,
} as const;

export const AI_QUEUE_JOB_OPTIONS = {
  attempts: AI_JOB_RETRY.ATTEMPTS,
  backoff: {
    type: 'exponential' as const,
    delay: AI_JOB_RETRY.BACKOFF_DELAY_MS,
  },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export const AI_JOB_RECOVERY = {
  STARTUP_DELAY_MS: 30000,
  SCAN_INTERVAL_MS: 15 * 60 * 1000,
  REQUEUE_AFTER_MS: 60 * 60 * 1000,
  BATCH_SIZE: 20,
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
