import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ReviewProjectHandoffDto {
  @IsIn(['approved', 'changes_requested'])
  decision!: 'approved' | 'changes_requested';

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  feedback?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  summary?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2000)
  liveUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { each: true },
  )
  artifactUrls?: string[];

  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsBoolean()
  manualReviewAcknowledged?: boolean;
}
