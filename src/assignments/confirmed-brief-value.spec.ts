import { confirmedBriefValue } from './confirmed-brief-value';

describe('confirmedBriefValue', () => {
  it.each([
    'idk',
    "I don't know",
    'not sure',
    'N/A',
    'like what?',
    'like what? coverage',
  ])('suppresses low-information answer %s', (value) => {
    expect(confirmedBriefValue(value)).toBeNull();
  });

  it('keeps a concrete requirement even if it contains similar words', () => {
    expect(
      confirmedBriefValue('Users do not know which invoice is overdue.'),
    ).toBe('Users do not know which invoice is overdue.');
  });
});
