import {
  IsEmail,
  IsIn,
  IsPhoneNumber,
  IsString,
  IsStrongPassword,
} from 'class-validator';
import { UserRole } from 'src/common/enums/user-role.enum';

export class SignUpUserDto {
  @IsString({ message: 'Invalid First name' })
  firstName!: string;
  @IsString({ message: 'Invalid last name' }) lastName!: string;
  @IsEmail() email!: string;
  @IsStrongPassword() password!: string;
  @IsPhoneNumber('EG') phoneNumber!: string;
  @IsIn([UserRole.CUSTOMER, UserRole.FREELANCER])
  role!: UserRole;
}
