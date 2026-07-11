import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateBriefMessageDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'content must contain non-whitespace characters' })
  content!: string;
}
