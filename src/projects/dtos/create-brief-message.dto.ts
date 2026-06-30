import { IsNotEmpty, IsString } from 'class-validator';

export class CreateBriefMessageDto {
  @IsString()
  @IsNotEmpty()
  content!: string;
}
