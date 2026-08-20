import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ClientHandoffDecisionDto {
  @IsIn(['accepted', 'changes_requested'])
  decision!: 'accepted' | 'changes_requested';

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  feedback?: string;
}
