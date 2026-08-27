import {
  IsEmail,
  IsIn,
  IsPhoneNumber,
  IsString,
  IsStrongPassword,
  IsDefined,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
import { UserRole } from 'src/common/enums/user-role.enum';
import {
  GITHUB_USERNAME_MAX_LENGTH,
  GITHUB_USERNAME_MESSAGE,
  GITHUB_USERNAME_PATTERN,
  normalizeGithubUsername,
} from 'src/common/validation/github-username';

export class SignUpUserDto {
  @IsString({ message: 'Invalid First name' })
  @Transform(trim)
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;
  @IsString({ message: 'Invalid last name' })
  @Transform(trim)
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @IsStrongPassword()
  @MaxLength(128)
  password!: string;
  @IsPhoneNumber('EG') phoneNumber!: string;
  @IsIn([UserRole.CUSTOMER, UserRole.FREELANCER])
  role!: UserRole;

  @ValidateIf((dto: SignUpUserDto) => dto.role === UserRole.FREELANCER)
  @IsDefined({ message: 'githubUsername is required for freelancers' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeGithubUsername(value) : value,
  )
  @IsString()
  @MinLength(1, { message: 'githubUsername is required for freelancers' })
  @MaxLength(GITHUB_USERNAME_MAX_LENGTH)
  @Matches(GITHUB_USERNAME_PATTERN, { message: GITHUB_USERNAME_MESSAGE })
  githubUsername?: string;
}
