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
  ) {
    super(message);
    this.name = "LarkResourceCommandError";
  }
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
): LarkResourceCommandError {
  if (detail === undefined) return new LarkResourceCommandError(fallback);
  const message = [detail.message, detail.hint, detail.code]
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(String)
    .join("; ");
  return new LarkResourceCommandError(
    message.length > 0 ? message : stableJson(detail),
    typeof detail.type === "string" ? detail.type : undefined,
    typeof detail.subtype === "string" ? detail.subtype : undefined,
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
    throw commandError(fallback, errorDetail(result.stderr));
  }
  const trimmed = result.stdout.trim();
  if (!trimmed.startsWith("{")) return result.stdout;
  try {
    const envelope = JSON.parse(trimmed) as unknown;
    if (envelope !== null && typeof envelope === "object" && !Array.isArray(envelope)) {
      const record = envelope as Record<string, unknown>;
      if (record.ok === false) {
        throw commandError("lark-cli returned ok=false", errorDetail(trimmed));
      }
    }
  } catch (error) {
    if (error instanceof SyntaxError) return result.stdout;
    throw error;
  }
  return result.stdout;
}
