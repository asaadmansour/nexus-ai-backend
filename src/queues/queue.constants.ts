export const QUEUES = {
  CV_EXTRACTION: 'cv-extraction',
  ASSESSMENT_GENERATION: 'assessment-generation',
  ASSESSMENT_GRADING: 'assessment-grading',
} as const;

export const JOBS = {
  EXTRACT_CV: 'extract-cv',
  GENERATE_ASSESSMENT: 'generate-assessment',
  GRADE_ASSESSMENT: 'grade-assessment',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
