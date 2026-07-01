// Maps to the Postgres enum type `project_status`.
export enum ProjectStatus {
  DRAFT = 'draft',
  IN_PROGRESS = 'in_progress',
  BRIEF_COMPLETE = 'brief_complete',
  SPEC_IN_PROGRESS = 'spec_in_progress',
  SPEC_UNDER_REVIEW = 'spec_under_review',
  SPEC_COMPLETE = 'spec_complete',
  SCOPED = 'scoped',
  ASSIGNED = 'assigned',
  ACTIVE = 'active',
  UNDER_REVIEW = 'under_review',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  DISPUTED = 'disputed',
}
