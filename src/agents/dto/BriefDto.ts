import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class BriefRecentMessageDto {
  @IsString()
  @IsNotEmpty()
  senderType!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsString()
  createdAt?: string;
}

export class BriefDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  briefId?: string;

  @IsString()
  @IsNotEmpty()
  briefText!: string;

  @IsOptional()
  @IsObject()
  currentBrief?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BriefRecentMessageDto)
  recentMessages?: BriefRecentMessageDto[];
}
