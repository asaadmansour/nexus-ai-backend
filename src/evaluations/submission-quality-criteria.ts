/**
 * Baseline engineering standards for implementation submissions.
 *
 * These are sent as explicit rubric rows instead of being left as prompt-only
 * guidance. That makes a missing model finding fail closed during evaluation.
 */
export const IMPLEMENTATION_QUALITY_CRITERIA = [
  'The implementation satisfies the task description and intended behavior without omitting required behavior.',
  'The implementation is functionally correct and handles relevant edge cases and failure paths.',
  'The code is clear, cohesive, consistently named, and free from unnecessary duplication, dead code, and debug artifacts.',
  'The design applies SOLID principles, separation of concerns, and modular dependency boundaries where applicable without needless complexity.',
  'Automated tests cover the changed behavior, important failure paths, and regressions, and the supplied verification evidence passes.',
  'The implementation preserves the approved architecture, API and data contracts, and integration compatibility.',
  'Security and privacy controls are appropriate: inputs are validated, authorization is enforced, secrets are not exposed, and sensitive data is handled safely.',
  'The change is maintainable and operationally ready, with useful error handling and logging plus documentation or migration notes where applicable.',
] as const;

export const IMPLEMENTATION_SUBMISSION_TYPES = new Set([
  'repo',
  'pull_request',
  'zip',
]);
