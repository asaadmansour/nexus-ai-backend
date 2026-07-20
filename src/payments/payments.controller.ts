import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { CreateEscrowIntentDto } from './dtos/create-escrow-intent.dto';
import { CreateFreelancerOnboardingLinkDto } from './dtos/create-freelancer-onboarding-link.dto';
import { ReleasePaymentDto } from './dtos/release-payment.dto';
import { PaymentsService } from './payments.service';

@Controller()
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('payments/customer/setup-intent')
  @Roles(UserRole.CUSTOMER)
  createCustomerSetupIntent(@CurrentUser() user: JwtPayload) {
    return this.paymentsService.createCustomerSetupIntent(user.sub);
  }

  @Post('payments/freelancer/onboarding-link')
  @Roles(UserRole.FREELANCER)
  createFreelancerOnboardingLink(
    @CurrentUser() user: JwtPayload,
    @Body() payload: CreateFreelancerOnboardingLinkDto,
  ) {
    return this.paymentsService.createFreelancerOnboardingLink(
      user.sub,
      payload,
    );
  }

  @Post('payments/freelancer/dashboard-link')
  @Roles(UserRole.FREELANCER)
  createFreelancerDashboardLink(@CurrentUser() user: JwtPayload) {
    return this.paymentsService.createFreelancerDashboardLink(user.sub);
  }

  @Get('payments/freelancer/account')
  @Roles(UserRole.FREELANCER)
  getFreelancerAccount(@CurrentUser() user: JwtPayload) {
    return this.paymentsService.getFreelancerAccount(user.sub);
  }

  @Get('payments/customer/projects')
  @Roles(UserRole.CUSTOMER)
  getCustomerPaymentProjects(@CurrentUser() user: JwtPayload) {
    return this.paymentsService.getCustomerPaymentProjects(user.sub);
  }

  @Post('projects/:projectId/payments/escrow-intent')
  @Roles(UserRole.CUSTOMER)
  createEscrowIntent(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() payload: CreateEscrowIntentDto,
  ) {
    return this.paymentsService.createEscrowIntent(projectId, user.sub, payload);
  }

  @Post('projects/:projectId/payments/checkout-session')
  @Roles(UserRole.CUSTOMER)
  createEscrowCheckoutSession(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
    @Body() payload: CreateEscrowIntentDto,
  ) {
    return this.paymentsService.createEscrowCheckoutSession(
      projectId,
      user.sub,
      payload,
    );
  }

  @Get('projects/:projectId/payments/summary')
  @Roles(UserRole.CUSTOMER)
  getProjectPaymentSummary(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.getProjectPaymentSummary(projectId, user);
  }

  @Get('projects/:projectId/payments')
  @Roles(UserRole.CUSTOMER)
  getProjectPayments(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.getProjectPayments(projectId, user);
  }

  @Post('projects/:projectId/payments/:paymentId/release')
  @Roles(UserRole.ADMIN)
  releaseProjectPayment(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: JwtPayload,
    @Body() payload: ReleasePaymentDto,
  ) {
    return this.paymentsService.releaseProjectPayment(
      projectId,
      paymentId,
      user,
      payload,
    );
  }

  @Get('admin/payments')
  @Roles(UserRole.ADMIN)
  getAdminPayments() {
    return this.paymentsService.getAdminPayments();
  }
}
