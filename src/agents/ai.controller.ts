import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { BriefDto } from './dto/BriefDto';
import { ExtractCvDto } from './dto/ExtractCvDto';
import { GenerateAssessmentDto } from './dto/GenerateAssessmentDto';
import { GradeAssessmentDto } from './dto/GradeAssessmentDto';

@Controller('ai')
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
}
