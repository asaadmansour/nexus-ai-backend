import { IsBoolean, IsOptional } from 'class-validator';

export class MaterializePlanDto {
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;
}
