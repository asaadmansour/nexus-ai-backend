import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateProjectDto } from './dtos/create-project.dto';

function validProject(overrides: Record<string, unknown> = {}) {
  const deadline = new Date();
  deadline.setUTCDate(deadline.getUTCDate() + 7);
  return plainToInstance(CreateProjectDto, {
    title: 'A valid project',
    description: 'Build a documented landing page.',
    budgetMin: 100,
    budgetMax: 1000,
    currency: 'egp',
    deadline: deadline.toISOString().slice(0, 10),
    isDeadlineFlexible: false,
    ...overrides,
  });
}

describe('CreateProjectDto business validation', () => {
  it('rejects past deadlines and inverted budgets', async () => {
    const dto = validProject({
      budgetMin: 2000,
      budgetMax: 1000,
      deadline: '2020-01-01',
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['budgetMin', 'deadline']),
    );
  });

  it('normalizes supported currency and accepts a properly scheduled project', async () => {
    const dto = validProject();
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.currency).toBe('EGP');
  });

  it('rejects monetary values that cannot fit the database column', async () => {
    const errors = await validate(validProject({ budgetMax: 10_000_000_000 }));
    expect(errors.some((error) => error.property === 'budgetMax')).toBe(true);
  });
});
