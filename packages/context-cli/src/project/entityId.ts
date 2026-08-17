import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

export function isSafeEntityId(id: string): boolean {
  return id.length > 0 &&
    !id.startsWith("/") &&
    !/^[a-zA-Z]:[\\/]/u.test(id) &&
    id.split(/[\\/]+/u).every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function assertSafeEntityId(id: string): void {
  if (!isSafeEntityId(id)) {
    throw new ContextError(ExitCode.WorkspaceStateError, `unsafe candidate id: ${id}`, {
      category: ErrorCategory.SchemaInvalid,
      id,
    });
  }
}
