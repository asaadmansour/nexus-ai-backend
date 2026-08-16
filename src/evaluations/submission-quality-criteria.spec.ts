import { buildImplementationEvaluationRubric } from './submission-quality-criteria';

describe('buildImplementationEvaluationRubric', () => {
  it('does not impose enterprise concerns on a tiny static deliverable', () => {
    const snapshot = buildImplementationEvaluationRubric({
      submissionType: 'pull_request',
      capturedAt: '2026-08-16T00:00:00.000Z',
      task: {
        title: 'Hello World page',
        description: 'Display one approved string.',
        acceptanceCriteria: [
          'The page displays Hello World',
          'The production page loads successfully',
        ],
        deliverables: [
          'Repository with the implementation',
          'Live deployment URL',
        ],
        integrationChecks: [
          'Production URL returns the expected page',
          'The browser console has no errors',
        ],
      },
      projectSpec: {
        apiContract: { applicable: false, reason: 'No API' },
        dataModel: { applicable: false, reason: 'No persistent data' },
      },
    });

    expect(snapshot.profile).toMatchObject({
      complexity: 'trivial',
      requiresAutomatedTests: false,
    });
    expect(snapshot.criteria.map((item) => item.key)).toEqual([
      'acceptance_1',
      'acceptance_2',
      'deliverable_1',
      'deliverable_2',
      'integration_1',
      'integration_2',
      'quality_functional_correctness',
      'quality_code_clarity',
      'security_baseline',
      'verification_proportionate',
    ]);
  });

  it('adds only the specialized gates signaled by a risky API task', () => {
    const snapshot = buildImplementationEvaluationRubric({
      submissionType: 'repo',
      task: {
        title: 'Create authenticated order endpoint',
        description: 'Persist an order and reject unauthorized callers.',
        acceptanceCriteria: ['POST /orders returns 201 for an authorized user'],
        contractReferences: ['POST /orders v1'],
        ownedPaths: ['src/orders/**'],
      },
    });
    const keys = snapshot.criteria.map((item) => item.key);

    expect(snapshot.profile).toMatchObject({
      complexity: 'complex',
      requiresAutomatedTests: true,
      capabilities: {
        api: true,
        data: true,
        authenticationOrPrivacy: true,
      },
    });
    expect(keys).toEqual(
      expect.arrayContaining([
        'verification_automated_tests',
        'contract_compatibility',
        'contract_reference_1',
        'security_auth_privacy',
        'scope_owned_paths',
      ]),
    );
    expect(keys).not.toContain('operations_readiness');
  });

  it('does not add code quality rows to a text artifact', () => {
    const snapshot = buildImplementationEvaluationRubric({
      submissionType: 'text',
      task: { acceptanceCriteria: ['Explain the approach'] },
    });

    expect(snapshot.criteria).toEqual([]);
  });
});
