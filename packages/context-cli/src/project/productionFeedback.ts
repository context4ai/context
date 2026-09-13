import { ZodError, type ZodTypeAny } from "zod";
import { YAMLParseError } from "yaml";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";

/** Add recovery information at the production boundary, without new checks,
 * retries or reads. Existing specific errors keep their category and reason. */
export async function withProductionFeedback<T>(input: {
  operation: string; file?: string | undefined; schema?: ZodTypeAny; recovery?: string;
}, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    const schemaError = error instanceof ZodError;
    const syntaxError = error instanceof YAMLParseError;
    const existing = error instanceof ContextError ? error : undefined;
    const ioCode = (error as NodeJS.ErrnoException | undefined)?.code;
    const detail: Record<string, unknown> = {
      category: schemaError || syntaxError ? ErrorCategory.UserInputInvalid : ErrorCategory.WorkspaceStateInvalid,
      reason_code: `production-${input.operation}-failed`,
      next_action: { command: "context status --format json", ...(input.recovery ? { instruction: input.recovery } : {}) },
      ...(input.file ? { file: input.file } : {}),
      ...(schemaError ? { issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })) } : {}),
      ...(syntaxError && error.linePos ? { location: error.linePos } : {}),
      ...(typeof ioCode === "string" ? { io_code: ioCode } : {}),
      ...existing?.detail,
    };
    // Return only the actual command input contract, never internal stage state.
    if (input.schema && detail.input_schema === undefined) {
      detail.input_schema = zodToJsonSchema(input.schema, { $refStrategy: "none" });
    }
    throw new ContextError(existing?.code ?? (schemaError || syntaxError ? ExitCode.UserError : ExitCode.WorkspaceStateError),
      error instanceof Error ? error.message : String(error), detail);
  }
}
