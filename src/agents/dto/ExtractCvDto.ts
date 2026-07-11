import { IsNotEmpty, IsUrl } from 'class-validator';

export class ExtractCvDto {
  @IsUrl()
  @IsNotEmpty()
  cvUrl!: string;
}
