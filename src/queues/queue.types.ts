export interface CvExtractionJobData {
  agentJobId: string;
  userId: string;
  profileId: string;
  cvUrl: string;
}

export interface AssessmentGenerationJobData {
  agentJobId: string;
  userId: string;
  profileId: string;
  cvUrl: string;
  questionCount: number;
  durationSeconds: number;
}

export interface ProfileEmbeddingJobData {
  agentJobId: string;
  userId: string;
  profileId: string;
  assessmentId?: string | null;
  reason: string;
}
