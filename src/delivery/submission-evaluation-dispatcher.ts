export const SUBMISSION_EVALUATION_DISPATCHER = Symbol(
  'SUBMISSION_EVALUATION_DISPATCHER',
);

export interface SubmissionEvaluationDispatchResult {
  evaluationRunId: string;
  agentJobId: string;
}

export interface SubmissionEvaluationDispatcher {
  queueSubmissionEvaluation(input: {
    submissionId: string;
    projectId: string;
    taskId: string;
    requestedBy: string;
  }): Promise<SubmissionEvaluationDispatchResult>;
}
