import {
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateUserDto {
  @IsString({ message: 'Invalid First name' })
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @IsString({ message: 'Invalid last name' })
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @IsPhoneNumber('EG')
  @IsOptional()
  phoneNumber?: string;
}
