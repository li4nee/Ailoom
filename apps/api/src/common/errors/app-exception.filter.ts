// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, Logger } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';

import type { ErrorCode, ErrorDetail, ErrorEnvelope } from '@app/shared';

import { AppError } from './app-error';

const STATUS_CODE: Record<number, ErrorCode> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'rate_limited',
};

function codeForStatus(status: number): ErrorCode {
  return STATUS_CODE[status] ?? (status >= 500 ? 'internal_error' : 'validation_failed');
}

function isBodyTooLarge(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; type?: unknown; statusCode?: unknown };
  return (
    candidate.type === 'entity.too.large' ||
    candidate.statusCode === 413 ||
    candidate.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
  );
}

function zodDetails(exception: ZodValidationException): ErrorDetail[] {
  const error = exception.getZodError() as {
    issues?: { path: (string | number)[]; message: string }[];
  };
  return (error.issues ?? []).map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

function requestIdOf(request: IncomingMessage): string {
  const value = request.headers['x-request-id'];
  return typeof value === 'string' ? value : '';
}

/**
 * The single exit point for errors: every response body is the shared error envelope and
 * unknown errors keep their message and stack out of the response.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<IncomingMessage>();
    const response = http.getResponse<ServerResponse>();
    const requestId = requestIdOf(request);

    const { status, code, message, details } = this.describe(exception);
    const envelope: ErrorEnvelope = {
      error: { code, message, ...(details === undefined ? {} : { details }), requestId },
    };
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(envelope));
  }

  private describe(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        ...(exception.details === undefined ? {} : { details: exception.details }),
      };
    }

    if (exception instanceof ZodValidationException) {
      return {
        status: 400,
        code: 'validation_failed',
        message: 'The request is invalid.',
        details: zodDetails(exception),
      };
    }

    if (isBodyTooLarge(exception)) {
      return {
        status: 413,
        code: 'payload_too_large',
        message: 'The request payload is too large.',
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = codeForStatus(status);
      return {
        status,
        code,
        message: status >= 500 ? 'An internal error occurred.' : exception.message,
      };
    }

    this.logger.error(
      'unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return { status: 500, code: 'internal_error', message: 'An internal error occurred.' };
  }
}
