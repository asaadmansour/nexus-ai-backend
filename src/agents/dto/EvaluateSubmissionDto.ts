// Internal gateway DTO — built by EvaluationsService and passed straight to the
// FastAPI /agents/evaluate-submission agent (not validated via HTTP pipe).
export interface EvaluateSubmissionTask {
  taskId: string;
  title: string;
  description?: string | null;
  isSpecTask: boolean;
  deliverables?: string[];
  acceptanceCriteria?: string[];
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
}

export class EvaluateSubmissionDto {
  project!: { projectId: string; title?: string | null };
  task!: EvaluateSubmissionTask;
  submission!: EvaluateSubmissionArtifact;
  brief?: Record<string, unknown> | null;
  projectSpec?: Record<string, unknown> | null;
}
