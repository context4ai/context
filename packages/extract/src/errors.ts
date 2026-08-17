export const NO_ENTRY_DETECTED = "NO_ENTRY_DETECTED" as const;

export class ExtractionInputError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "ExtractionInputError";
    this.code = code;
    this.detail = detail;
  }
}
