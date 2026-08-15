import { canFreelancerTransitionTask } from './project-plans.service';

describe('Sprint 5 task workflow', () => {
  it('allows freelancers to start and block their own work', () => {
    expect(canFreelancerTransitionTask('todo', 'in_progress')).toBe(true);
    expect(canFreelancerTransitionTask('in_progress', 'blocked')).toBe(true);
    expect(
      canFreelancerTransitionTask('changes_requested', 'in_progress'),
    ).toBe(true);
  });

  it('does not let freelancers bypass submission review states', () => {
    expect(canFreelancerTransitionTask('todo', 'done')).toBe(false);
    expect(canFreelancerTransitionTask('in_progress', 'review')).toBe(false);
    expect(canFreelancerTransitionTask('review', 'in_progress')).toBe(false);
  });
});
