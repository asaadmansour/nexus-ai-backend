import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { BriefDto } from './dto/BriefDto';
import { ExtractCvDto } from './dto/ExtractCvDto';
import { GenerateAssessmentDto } from './dto/GenerateAssessmentDto';
import { GenerateEmbeddingDto } from './dto/GenerateEmbeddingDto';
import { GradeAssessmentDto } from './dto/GradeAssessmentDto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { VerifiedGuard } from 'src/common/guards/verified.guard';

@Controller('ai')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.CUSTOMER, UserRole.FREELANCER, UserRole.ADMIN)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('extract-cv')
  extractCv(@Body() cvDto: ExtractCvDto) {
    return this.aiService.extractCv(cvDto);
  }

  @Post('validate-brief')
  validateBrief(@Body() briefDto: BriefDto) {
    return this.aiService.validateBrief(briefDto);
  }

  @Post('generate-assessment')
  generateAssessment(@Body() assessmentDto: GenerateAssessmentDto) {
    return this.aiService.generateAssessment(assessmentDto);
  }

  @Post('grade-assessment')
  gradeAssessment(@Body() assessmentDto: GradeAssessmentDto) {
    return this.aiService.gradeAssessment(assessmentDto);
  }

  @Post('generate-embedding')
  generateEmbedding(@Body() embeddingDto: GenerateEmbeddingDto) {
    return this.aiService.generateEmbedding(embeddingDto);
  }
}
