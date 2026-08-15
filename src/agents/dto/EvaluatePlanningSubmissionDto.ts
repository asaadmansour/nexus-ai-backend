export interface PlanningEvaluationRequirementDto {
  key: string;
  title: string;
  description: string;
  mandatory: boolean;
  requiresUrl: boolean;
}

export class EvaluatePlanningSubmissionDto {
  project!: Record<string, unknown>;
  brief!: Record<string, unknown>;
  requirements!: PlanningEvaluationRequirementDto[];
  submission!: {
    submissionId: string;
    submissionVersion: number;
    submissionType: 'architecture' | 'ui_ux';
    title: string | null;
    summary: string | null;
    content: Record<string, unknown>;
    fileUrls: Record<string, unknown>;
  };
  approvedArchitecture?: Record<string, unknown> | null;
  previousVerdict?: Record<string, unknown> | null;
}
