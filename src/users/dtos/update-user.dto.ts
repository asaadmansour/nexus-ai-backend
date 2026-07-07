import { IsOptional, IsPhoneNumber, IsString } from 'class-validator';

export class UpdateUserDto {
  @IsString({ message: 'Invalid First name' })
  @IsOptional()
  firstName?: string;

  @IsString({ message: 'Invalid last name' })
  @IsOptional()
  lastName?: string;

  @IsPhoneNumber('EG')
  @IsOptional()
  phoneNumber?: string;
}
