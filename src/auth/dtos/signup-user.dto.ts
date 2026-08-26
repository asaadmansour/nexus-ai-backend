import {
  IsEmail,
  IsIn,
  IsPhoneNumber,
  IsString,
  IsStrongPassword,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
import { UserRole } from 'src/common/enums/user-role.enum';

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
}
