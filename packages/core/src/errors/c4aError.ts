import { ErrorCode } from "./errorCodes.js";

export type ErrorDetails = Record<string, unknown> | string | null;

export type ErrorResponse = {
  code: ErrorCode;
  message: string;
  details?: ErrorDetails;
};

export class C4AError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails | undefined;

  constructor(code: ErrorCode, message: string, details?: ErrorDetails, options?: ErrorOptions) {
    super(message, options);
    this.name = "C4AError";
    this.code = code;
    this.details = details;
  }

  toResponse(): ErrorResponse {
    if (this.details === undefined) {
      return { code: this.code, message: this.message };
    }

    return { code: this.code, message: this.message, details: this.details };
  }
}
