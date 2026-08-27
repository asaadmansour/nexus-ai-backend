import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';

interface PostgresDriverError {
  code?: string;
  constraint?: string;
  detail?: string;
}

@Catch(QueryFailedError)
export class DatabaseExceptionFilter implements ExceptionFilter<QueryFailedError> {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);

  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const translated = this.toHttpException(exception);
    const driverError = exception.driverError as PostgresDriverError;
    this.logger.error(
      `Database query failed (code=${driverError.code ?? 'unknown'}, constraint=${driverError.constraint ?? 'unknown'}): ${driverError.detail ?? exception.message}`,
    );
    const statusCode = translated.getStatus();
    const exceptionResponse = translated.getResponse();

    response.status(statusCode).json(
      typeof exceptionResponse === 'string'
        ? {
            statusCode,
            message: exceptionResponse,
            error: translated.name,
          }
        : exceptionResponse,
    );
  }

  private toHttpException(exception: QueryFailedError): HttpException {
    const driverError = exception.driverError as PostgresDriverError;

    if (driverError.code === '23505') {
      return new ConflictException(
        this.getUniqueConstraintMessage(driverError),
      );
    }

    return new InternalServerErrorException('Database request failed');
  }

  private getUniqueConstraintMessage(error: PostgresDriverError): string {
    const constraint = error.constraint?.toLowerCase() ?? '';

    if (['uq_user_email', 'users_email_key'].includes(constraint)) {
      return 'This email is already registered.';
    }

    if (
      ['uq_user_phone_number', 'users_phone_number_key'].includes(constraint)
    ) {
      return 'This phone number is already registered.';
    }

    if (constraint === 'freelancer_profiles_github_username_uidx') {
      return 'This GitHub username is already registered.';
    }

    if (constraint === 'project_role_assignments_planning_freelancer_uidx') {
      return 'Architecture and UI/UX planning roles must be assigned to different freelancers.';
    }

    return 'This record already exists.';
  }
}
