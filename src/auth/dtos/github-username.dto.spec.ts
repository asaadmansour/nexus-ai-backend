import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { CompleteSignupDto } from './complete-signup.dto';
import { SignUpUserDto } from './signup-user.dto';

const baseSignup = {
  firstName: 'Nexus',
  lastName: 'Freelancer',
  email: 'freelancer@example.com',
  password: 'Strong!Password1',
  phoneNumber: '+201001234567',
};

describe('freelancer GitHub username onboarding', () => {
  it('requires a GitHub username for password-based freelancer signup', () => {
    const dto = plainToInstance(SignUpUserDto, {
      ...baseSignup,
      role: UserRole.FREELANCER,
    });

    expect(
      validateSync(dto).some((error) => error.property === 'githubUsername'),
    ).toBe(true);
  });

  it('does not require a GitHub username for customer signup', () => {
    const dto = plainToInstance(SignUpUserDto, {
      ...baseSignup,
      role: UserRole.CUSTOMER,
    });

    expect(
      validateSync(dto).some((error) => error.property === 'githubUsername'),
    ).toBe(false);
  });

  it('trims and accepts a valid freelancer GitHub username', () => {
    const dto = plainToInstance(SignUpUserDto, {
      ...baseSignup,
      role: UserRole.FREELANCER,
      githubUsername: '  nexus-dev  ',
    });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.githubUsername).toBe('nexus-dev');
  });

  it('requires a GitHub username when Google signup selects freelancer', () => {
    const dto = plainToInstance(CompleteSignupDto, {
      phoneNumber: '+201001234567',
      role: UserRole.FREELANCER,
    });

    expect(
      validateSync(dto).some((error) => error.property === 'githubUsername'),
    ).toBe(true);
  });
});
