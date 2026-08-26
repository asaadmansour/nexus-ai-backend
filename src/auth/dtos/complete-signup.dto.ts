import {
  IsIn,
  IsPhoneNumber,
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from 'src/common/enums/user-role.enum';

export class CompleteSignupDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @IsPhoneNumber('EG')
  phoneNumber!: string;

  @IsIn([UserRole.CUSTOMER, UserRole.FREELANCER])
  role!: UserRole;
}
