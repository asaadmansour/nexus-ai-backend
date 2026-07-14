import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchingCandidate } from './entities/matching-candidate.entity';
import { MatchingRun } from './entities/matching-run.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MatchingRun, MatchingCandidate])],
  exports: [TypeOrmModule],
})
export class MatchingModule {}
