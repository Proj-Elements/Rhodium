/**
 * Application-level error with an HTTP status. Throw it anywhere in API routes;
 * `handleApiError` turns it into a JSON response without guessing from the message.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export function badRequest(message: string): AppError {
  return new AppError(message, 400);
}

export function conflict(message: string): AppError {
  return new AppError(message, 409);
}

export function notFound(message = "请求的数据不存在"): AppError {
  return new AppError(message, 404);
}
