export interface LarkResourceCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface LarkResourceCommandOptions {
  cwd?: string;
}

export type LarkResourceCommandRunner = (
  args: string[],
  options?: LarkResourceCommandOptions,
) => Promise<LarkResourceCommandResult>;

export class LarkResourceCommandError extends Error {
  constructor(
    message: string,
    readonly errorType?: string,
    readonly errorSubtype?: string,
    readonly code?: string | number,
    readonly logId?: string,
    readonly missingScope = false,
  ) {
    super(message);
    this.name = "LarkResourceCommandError";
  }
}

/** Lark may put an application scope error inside the CLI's HTTP 400 message. */
function hasMissingScope(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null) return false;
  if (typeof value === "string") {
    const start = value.indexOf("{");
    if (start < 0) return false;
    try {
      return hasMissingScope(JSON.parse(value.slice(start)) as unknown, depth + 1);
    } catch {
      return false;
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (String(record.code) === "99991672") return true;
  if (Array.isArray(record.permission_violations) && record.permission_violations.some((item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item) &&
    (item as Record<string, unknown>).type === "action_scope_required"
  )) return true;
  return [record.error, record.cause, record.message].some((item) => hasMissingScope(item, depth + 1));
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function errorDetail(value: string): Record<string, unknown> | undefined {
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  try {
    const envelope = JSON.parse(value.slice(start)) as unknown;
    if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) return undefined;
    const error = (envelope as Record<string, unknown>).error;
    return error !== null && typeof error === "object" && !Array.isArray(error)
      ? error as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function commandError(
  fallback: string,
  detail: Record<string, unknown> | undefined,
  sources: readonly string[] = [],
): LarkResourceCommandError {
  const missingScope = hasMissingScope(detail) || [fallback, ...sources].some((source) => hasMissingScope(source));
  if (detail === undefined) return new LarkResourceCommandError(fallback, undefined, undefined, undefined, undefined, missingScope);
  const message = [detail.message, detail.hint, detail.code]
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(String)
    .join("; ");
  return new LarkResourceCommandError(
    message.length > 0 ? message : stableJson(detail),
    typeof detail.type === "string" ? detail.type : undefined,
    typeof detail.subtype === "string" ? detail.subtype : undefined,
    typeof detail.code === "string" || typeof detail.code === "number" ? detail.code : undefined,
    typeof detail.log_id === "string" ? detail.log_id : undefined,
    missingScope,
  );
}

export async function runLarkResourceCommand(
  runner: LarkResourceCommandRunner,
  args: string[],
  options?: LarkResourceCommandOptions,
): Promise<string> {
  const result = await runner(args, options);
  if (result.exitCode !== 0) {
    const fallback = result.stderr.trim()
      || `lark-cli ${args.slice(0, 2).join(" ")} failed with exit code ${result.exitCode ?? "unknown"}`;
    throw commandError(fallback, errorDetail(result.stderr) ?? errorDetail(result.stdout), [result.stderr, result.stdout]);
  }
  const trimmed = result.stdout.trim();
  if (!trimmed.startsWith("{")) return result.stdout;
  try {
    const envelope = JSON.parse(trimmed) as unknown;
    if (envelope !== null && typeof envelope === "object" && !Array.isArray(envelope)) {
      const record = envelope as Record<string, unknown>;
      if (record.ok === false) {
        throw commandError("lark-cli returned ok=false", errorDetail(trimmed), [trimmed]);
      }
    }
  } catch (error) {
    if (error instanceof SyntaxError) return result.stdout;
    throw error;
  }
  return result.stdout;
}

/** Only explicit permission failures qualify for non-blocking resource capture. */
export function isLarkResourcePermissionDenied(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  // Synced block readers use the document command error, which retains CLI stderr.
  const detail = error instanceof LarkResourceCommandError
    ? { type: error.errorType, subtype: error.errorSubtype, code: error.code }
    : errorDetail(stderr);
  return (error instanceof LarkResourceCommandError && error.missingScope) ||
    hasMissingScope(detail) || hasMissingScope(stderr) ||
    String(detail?.code) === "403" ||
    (detail?.type === "authorization" &&
      ["permission_denied", "access_denied", "missing_scope"].includes(String(detail.subtype ?? "")));
}
