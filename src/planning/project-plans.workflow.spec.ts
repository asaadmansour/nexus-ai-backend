import {
  canFreelancerTransitionTask,
  ProjectPlansService,
} from './project-plans.service';

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

  it('lists only the signed-in freelancer tasks with project and budget context', async () => {
    const profileRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'profile-1' }),
    };
    const taskRepo = {
      findAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: 'task-1',
            projectId: 'project-1',
            projectPlanId: 'plan-1',
            milestoneId: 'milestone-1',
            assignmentId: 'assignment-1',
            assignedFreelancerProfileId: 'profile-1',
            title: 'Build the API',
            description: null,
            status: 'todo',
            priority: 'high',
            roleKey: 'backend',
            requiredSkills: ['NestJS'],
            estimatedHours: '8.00',
            budgetAmount: '1200.00',
            currency: 'EGP',
            orderIndex: 1,
            startsAt: null,
            dueAt: null,
            acceptanceCriteria: ['Contract tests pass'],
            metadata: {},
            sourceMatchingRunId: 'run-1',
            sourceCandidateId: 'candidate-1',
            assignedBy: 'admin-1',
            assignedAt: new Date('2026-01-01T00:00:00Z'),
            project: {
              id: 'project-1',
              title: 'Nexus',
              status: 'in_progress',
              currency: 'EGP',
            },
            milestone: {
              id: 'milestone-1',
              title: 'API foundation',
              status: 'planned',
            },
            dependencies: [],
          },
        ],
        1,
      ]),
    };
    const service = Object.assign(
      Object.create(ProjectPlansService.prototype),
      {
        profileRepo,
        taskRepo,
      },
    ) as ProjectPlansService;

    const result = await service.listAssignedFreelancerTasks('user-1', {
      page: 1,
      limit: 50,
    });

    expect(profileRepo.findOne).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(taskRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignedFreelancerProfileId: 'profile-1' },
        relations: ['dependencies', 'project', 'milestone'],
      }),
    );
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      id: 'task-1',
      budgetAmount: '1200.00',
      currency: 'EGP',
      project: { id: 'project-1', title: 'Nexus' },
      milestone: { id: 'milestone-1', title: 'API foundation' },
    });
  });
});
