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

export interface ProjectPlanGenerationJobData {
  agentJobId: string;
  projectId: string;
  architectureSubmissionId?: string | null;
  uiuxSubmissionId?: string | null;
  requestedBy?: string | null;
  notes?: string | null;
}

export interface SubmissionEvaluationJobData {
  agentJobId: string;
  evaluationRunId: string;
  submissionId: string;
  projectId: string;
  taskId?: string | null;
}

export interface PlanningSubmissionEvaluationJobData {
  agentJobId: string;
  submissionId: string;
  projectId: string;
  requestedBy?: string | null;
}

export interface RequirementsDocumentProcessingJobData {
  documentId: string;
}
