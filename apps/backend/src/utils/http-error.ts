/** A thrown error that maps directly to an HTTP response. */
export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
