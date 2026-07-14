export const QUEUES = {
  CV_EXTRACTION: 'cv-extraction',
  ASSESSMENT_GENERATION: 'assessment-generation',
  ASSESSMENT_GRADING: 'assessment-grading',
  PROFILE_EMBEDDING: 'profile-embedding',
} as const;

export const JOBS = {
  EXTRACT_CV: 'extract-cv',
  GENERATE_ASSESSMENT: 'generate-assessment',
  GRADE_ASSESSMENT: 'grade-assessment',
  GENERATE_PROFILE_EMBEDDING: 'generate-profile-embedding',
} as const;

export const AI_JOB_RETRY = {
  ATTEMPTS: 3,
  BACKOFF_DELAY_MS: 5000,
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
