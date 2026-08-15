import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { CreatePaymentReleaseRequestDto } from './dtos/create-payment-release-request.dto';
import { ListPaymentReleaseRequestsDto } from './dtos/list-payment-release-requests.dto';
import { ReviewPaymentReleaseRequestDto } from './dtos/review-payment-release-request.dto';
import { PaymentReleaseRequestsService } from './payment-release-requests.service';

@Controller('projects/:projectId/payment-release-requests')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class ProjectPaymentReleaseRequestsController {
  constructor(
    private readonly releaseRequestsService: PaymentReleaseRequestsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER, UserRole.FREELANCER)
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreatePaymentReleaseRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.releaseRequestsService.create(projectId, dto, user);
    return { status: 'success', data };
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER, UserRole.FREELANCER)
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListPaymentReleaseRequestsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.releaseRequestsService.listProject(
      projectId,
      query,
      user,
    );
    return { status: 'success', ...result };
  }
}

@Controller('admin/payment-release-requests')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPaymentReleaseRequestsController {
  constructor(
    private readonly releaseRequestsService: PaymentReleaseRequestsService,
  ) {}

  @Get()
  async list(@Query() query: ListPaymentReleaseRequestsDto) {
    const result = await this.releaseRequestsService.listAdmin(query);
    return { status: 'success', ...result };
  }
}

@Controller('payment-release-requests')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PaymentReleaseRequestDetailController {
  constructor(
    private readonly releaseRequestsService: PaymentReleaseRequestsService,
  ) {}

  @Patch(':requestId/review')
  async review(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ReviewPaymentReleaseRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.releaseRequestsService.review(requestId, dto, user);
    return { status: 'success', data };
  }
}
