import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  InternalServerErrorException,
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
  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const translated = this.toHttpException(exception);
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

    return 'This record already exists.';
  }
}
