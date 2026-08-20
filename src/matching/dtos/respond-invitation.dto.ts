import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RespondInvitationDto {
  @IsIn(['accepted', 'declined'])
  decision!: 'accepted' | 'declined';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
