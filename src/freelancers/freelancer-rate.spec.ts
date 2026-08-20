import { calculateAssessedHourlyRate } from './freelancer-rate';

describe('calculateAssessedHourlyRate', () => {
  const previousMinimum = process.env.FREELANCER_MIN_HOURLY_RATE;
  const previousMaximum = process.env.FREELANCER_MAX_HOURLY_RATE;

  beforeEach(() => {
    process.env.FREELANCER_MIN_HOURLY_RATE = '150';
    process.env.FREELANCER_MAX_HOURLY_RATE = '1200';
  });

  afterAll(() => {
    if (previousMinimum === undefined) {
      delete process.env.FREELANCER_MIN_HOURLY_RATE;
    } else {
      process.env.FREELANCER_MIN_HOURLY_RATE = previousMinimum;
    }
    if (previousMaximum === undefined) {
      delete process.env.FREELANCER_MAX_HOURLY_RATE;
    } else {
      process.env.FREELANCER_MAX_HOURLY_RATE = previousMaximum;
    }
  });

  it('combines assessment, verified skills, and experience into a platform-owned rate', () => {
    expect(
      calculateAssessedHourlyRate(
        {
          assessmentScore: '80',
          yearsExperience: 5,
          interviewScore: null,
        },
        [{ score: '4.00' }, { score: '4.00' }],
      ),
    ).toBe(890);
  });
});
