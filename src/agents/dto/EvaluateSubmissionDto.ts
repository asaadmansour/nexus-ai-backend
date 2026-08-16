// Internal gateway DTO — built by EvaluationsService and passed straight to the
// FastAPI /agents/evaluate-submission agent (not validated via HTTP pipe).
export interface EvaluateSubmissionTask {
  taskId: string;
  title: string;
  description?: string | null;
  isSpecTask: boolean;
  deliverables?: string[];
  acceptanceCriteria?: string[];
  integrationChecks?: string[];
  contractReferences?: string[];
  ownedPaths?: string[];
  qualityCriteria?: string[];
}

export interface EvaluateSubmissionArtifact {
  submissionId: string;
  submissionType: string;
  submissionUrl?: string | null;
  repositoryUrl?: string | null;
  pullRequestUrl?: string | null;
  commitSha?: string | null;
  submissionText?: string | null;
  notes?: string | null;
  repositoryId?: string | null;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  pullRequestNumber?: number | null;
  baseCommitSha?: string | null;
  inspection?: Record<string, unknown> | null;
}

export class EvaluateSubmissionDto {
  project!: { projectId: string; title?: string | null };
  task!: EvaluateSubmissionTask;
  submission!: EvaluateSubmissionArtifact;
  brief?: Record<string, unknown> | null;
  projectSpec?: Record<string, unknown> | null;
  evaluationHistory?: Array<{
    evaluationRunId: string;
    submissionId: string | null;
    commitSha: string | null;
    score: string | null;
    recommendation: string | null;
    summary: string | null;
    unmetCriteria: string[];
    completedAt: string | null;
  }>;
}
