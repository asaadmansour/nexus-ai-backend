import { Body, Controller, Param, Post } from '@nestjs/common';
import { BriefService } from './brief.service';
import { CreateBriefMessageDto } from './dtos/create-brief-message.dto';

@Controller('projects/:projectId/brief')
export class BriefController {
  constructor(private readonly briefService: BriefService) {}

  @Post('messages')
  sendMessage(
    @Param('projectId') projectId: string,
    @Body() dto: CreateBriefMessageDto,
  ) {
    return this.briefService.sendCustomerMessage(projectId, dto);
  }
}
