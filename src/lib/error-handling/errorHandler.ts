export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND_ERROR = 'NOT_FOUND_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  FILE_UPLOAD_ERROR = 'FILE_UPLOAD_ERROR',
  PLAGIARISM_SCAN_ERROR = 'PLAGIARISM_SCAN_ERROR',
  CRAWLING_ERROR = 'CRAWLING_ERROR'
}

export class AppError extends Error {
  public readonly statusCode: number
  public readonly code: ErrorCode
  public readonly details?: any

  constructor(message: string, statusCode: number, code: ErrorCode, details?: any) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.details = details

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, AppError)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, ErrorCode.VALIDATION_ERROR, details)
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, ErrorCode.AUTHENTICATION_ERROR)
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, ErrorCode.AUTHORIZATION_ERROR)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, ErrorCode.NOT_FOUND_ERROR)
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, ErrorCode.RATE_LIMIT_ERROR)
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 500, ErrorCode.DATABASE_ERROR, details)
  }
}

export class ExternalApiError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 502, ErrorCode.EXTERNAL_API_ERROR, details)
  }
}

export class FileUploadError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, ErrorCode.FILE_UPLOAD_ERROR, details)
  }
}

export class PlagiarismScanError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 500, ErrorCode.PLAGIARISM_SCAN_ERROR, details)
  }
}

export class CrawlingError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 500, ErrorCode.CRAWLING_ERROR, details)
  }
}

export function createErrorResponse(error: AppError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details })
    }
  }
}

export function handleUnknownError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }

  if (error instanceof Error) {
    return new AppError(
      error.message,
      500,
      ErrorCode.SERVER_ERROR,
      { stack: error.stack }
    )
  }

  return new AppError(
    'An unknown error occurred',
    500,
    ErrorCode.SERVER_ERROR,
    { originalError: error }
  )
}

export async function asyncHandler<T>(
  fn: () => Promise<T>
): Promise<{ data?: T; error?: AppError }> {
  try {
    const data = await fn()
    return { data }
  } catch (error) {
    const appError = handleUnknownError(error)
    return { error: appError }
  }
}