import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateBriefMessageDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'content must contain non-whitespace characters' })
  @MaxLength(5000)
  content!: string;
}
