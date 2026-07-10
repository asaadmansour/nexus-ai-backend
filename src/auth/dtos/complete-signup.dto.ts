import { IsIn, IsPhoneNumber, IsString, IsOptional } from 'class-validator';
import { UserRole } from 'src/common/enums/user-role.enum';

export class CompleteSignupDto {
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsPhoneNumber('EG')
  phoneNumber!: string;

  @IsIn([UserRole.CUSTOMER, UserRole.FREELANCER])
  role!: UserRole;
}
