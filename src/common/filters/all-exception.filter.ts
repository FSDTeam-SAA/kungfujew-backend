import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: Logger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Ignore favicon requests - this is normal browser behavior
    if (request.url === '/favicon.ico') {
      response.status(204).end();
      return;
    }

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';
    let error = 'Error';

    statusCode = this.extractStatusCode(exception, statusCode);

    // Handle NestJS HttpException
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      message = this.extractHttpMessage(exception.getResponse(), message);
      error = exception.name;
    }

    // Generic JS Error
    else if (exception instanceof Error) {
      // statusCode = exception.;
      message = exception.message;
      error = exception.name;
    }

    const logPayload = {
      context: 'AllExceptionsFilter',
      statusCode,
      path: request.url,
      method: request.method,
      exception:
        exception instanceof Error
          ? exception.message
          : this.safeStringify(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    };

    if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
      this.logger.warn('Request throttled', logPayload);
    } else if (
      statusCode >= HttpStatus.BAD_REQUEST &&
      statusCode < HttpStatus.INTERNAL_SERVER_ERROR
    ) {
      this.logger.warn('Client request rejected', logPayload);
    } else {
      this.logger.error('Unhandled exception caught', logPayload);
    }

    response.status(statusCode).json({
      success: false,
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      stack:
        process.env.NODE_ENV === 'development' && exception instanceof Error
          ? exception.stack
          : null,
    });
  }

  private extractStatusCode(
    exception: unknown,
    fallback: HttpStatus,
  ): HttpStatus {
    if (
      typeof exception === 'object' &&
      exception !== null &&
      'status' in exception &&
      typeof exception.status === 'number'
    ) {
      return exception.status;
    }

    return fallback;
  }

  private extractHttpMessage(response: unknown, fallback: string): string {
    if (typeof response === 'string') {
      return response;
    }

    if (
      typeof response === 'object' &&
      response !== null &&
      'message' in response
    ) {
      const responseMessage = (response as { message: string | string[] })
        .message;
      return Array.isArray(responseMessage)
        ? responseMessage.join(', ')
        : responseMessage;
    }

    return fallback;
  }

  private safeStringify(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return 'Unknown exception';
    }
  }
}
