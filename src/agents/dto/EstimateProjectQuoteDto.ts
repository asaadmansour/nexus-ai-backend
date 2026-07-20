import { IsObject, IsOptional } from 'class-validator';

export class EstimateProjectQuoteDto {
  @IsObject()
  project!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  brief?: Record<string, unknown> | null;
}
