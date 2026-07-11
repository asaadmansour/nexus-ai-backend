import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MaxJsonSize } from 'src/common/validators/max-json-size.validator';

const MAX_BRIEF_TEXT_LENGTH = 5000;
const MAX_RECENT_MESSAGE_CONTENT_LENGTH = 2000;
const MAX_CURRENT_BRIEF_JSON_BYTES = 20000;
const MAX_RECENT_MESSAGES = 20;

export class BriefRecentMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  senderType!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_RECENT_MESSAGE_CONTENT_LENGTH)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
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
  @MaxLength(MAX_BRIEF_TEXT_LENGTH)
  briefText!: string;

  @IsOptional()
  @IsObject()
  @MaxJsonSize(MAX_CURRENT_BRIEF_JSON_BYTES)
  currentBrief?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RECENT_MESSAGES)
  @ValidateNested({ each: true })
  @Type(() => BriefRecentMessageDto)
  recentMessages?: BriefRecentMessageDto[];
}
