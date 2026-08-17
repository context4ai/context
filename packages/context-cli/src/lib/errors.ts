import type { ExitCode } from "../types/exitCode.js";

export class ContextError extends Error {
  readonly code: ExitCode;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: ExitCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "ContextError";
    this.code = code;
    this.detail = detail;
  }
}
