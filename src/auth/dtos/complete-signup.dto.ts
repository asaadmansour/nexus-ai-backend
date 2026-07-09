import { IsIn, IsPhoneNumber } from 'class-validator';
import { UserRole } from 'src/common/enums/user-role.enum';

export class CompleteSignupDto {
  @IsPhoneNumber('EG')
  phoneNumber!: string;

  @IsIn([UserRole.CUSTOMER, UserRole.FREELANCER])
  role!: UserRole;
}
