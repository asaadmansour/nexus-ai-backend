import { FreelancerAssessmentsService } from './freelancer-assessments.service';

describe('freelancer assessment candidate result', () => {
  const service = new FreelancerAssessmentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('exposes useful grading feedback without private admin notes or rubrics', () => {
    const summarize = Reflect.get(service, 'toAssessmentSummary') as (
      assessment: Record<string, unknown>,
    ) => Record<string, unknown>;
    const summary = summarize.call(service, {
      id: 'assessment-1',
      status: 'needs_review',
      score: '67.50',
      durationSeconds: 2700,
      startedAt: new Date(),
      expiresAt: new Date(),
      submittedAt: new Date(),
      targetRole: 'backend_engineer',
      targetSeniority: 'junior',
      resultRole: 'backend_engineer',
      resultSeniority: 'mid',
      aiFeedback: {
        recommendation: 'needs_review',
        feedback: 'Good API fundamentals; database reasoning needs more depth.',
        profileSummary: 'Strong on validation and REST boundaries.',
        manualReviewRequired: true,
        automationDecision: 'needs_review',
        graderConfidence: 0.72,
        integrityWarningCount: 1,
        adminNotes: 'Private reviewer note',
        rubric: { answer: 'private' },
        questionResults: [
          { score: 5, maxScore: 5, feedback: 'Clear validation approach.' },
          { score: 2, maxScore: 5, feedback: 'Review transaction isolation.' },
        ],
      },
    });

    expect(summary.result).toEqual(
      expect.objectContaining({
        gradingComplete: true,
        manualReviewRequired: true,
        performance: {
          questionsEvaluated: 2,
          strongAnswers: 1,
          partialAnswers: 0,
          weakAnswers: 1,
        },
        strengths: ['Clear validation approach.'],
        improvements: ['Review transaction isolation.'],
      }),
    );
    expect(JSON.stringify(summary)).not.toContain('Private reviewer note');
    expect(JSON.stringify(summary)).not.toContain('private');
  });
});
