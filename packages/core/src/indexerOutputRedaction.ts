export const INDEXER_OUTPUT_REDACTION_MARKER = "[REDACTED:indexer-output]";

export type IndexerOutputChannel =
  | "success-payload"
  | "stdout"
  | "stderr"
  | "exception-message"
  | "ipc-envelope"
  | "review-sample"
  | "audit-report";

export type IndexerBlockedOutputScalar = string | number;

export interface IndexerOutputRedactionPolicy {
  blocked_scalars?: readonly IndexerBlockedOutputScalar[];
}

export interface IndexerOutputRedactionResult<T> {
  value: T;
  redacted: boolean;
  replacement_count: number;
}

const SECRET_TOKEN = /^(?:password|passwd|pwd|secret|token|credential|credentials|cookie)$/u;
const SECRET_COMPOUND = /^(?:api-key|access-key|private-key|client-secret|access-token|refresh-token)$/u;
const NON_SECRET_SUFFIX = new Set([
  "budget",
  "count",
  "digest",
  "fingerprint",
  "hash",
  "index",
  "kind",
  "length",
  "limit",
  "name",
  "ref",
  "reference",
  "references",
  "refs",
  "status",
  "type",
]);

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .toLowerCase()
    .split("-")
    .filter(Boolean);
}

function sensitiveKey(key: string, value: unknown): boolean {
  const tokens = keyTokens(key);
  if (tokens.length === 0) return false;
  const normalized = tokens.join("-");
  if (normalized === "authorization" && value !== null && typeof value === "object") {
    return false;
  }
  if (NON_SECRET_SUFFIX.has(tokens.at(-1)!)) return false;
  return SECRET_COMPOUND.test(normalized) || tokens.some((token) => SECRET_TOKEN.test(token)) ||
    normalized === "authorization";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizedBlockedScalars(
  policy: IndexerOutputRedactionPolicy,
): IndexerBlockedOutputScalar[] {
  const identities = new Set<string>();
  const values: IndexerBlockedOutputScalar[] = [];
  for (const value of policy.blocked_scalars ?? []) {
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    if (typeof value === "string" && value.length === 0) continue;
    const identity = `${typeof value}:${String(value)}`;
    if (identities.has(identity)) continue;
    identities.add(identity);
    values.push(value);
  }
  return values.sort((left, right) => String(right).length - String(left).length);
}

interface MutableCount {
  replacements: number;
}

function replaceWithCount(
  value: string,
  pattern: RegExp,
  replacement: string | ((substring: string, ...args: string[]) => string),
  count: MutableCount,
): string {
  return value.replace(pattern, (...args: unknown[]) => {
    count.replacements += 1;
    if (typeof replacement === "string") return replacement;
    return replacement(...(args.slice(0, -2) as [string, ...string[]]));
  });
}

function redactKnownText(value: string, count: MutableCount): string {
  let output = value;
  output = replaceWithCount(
    output,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
    INDEXER_OUTPUT_REDACTION_MARKER,
    count,
  );
  output = replaceWithCount(
    output,
    /(\bauthorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/giu,
    (_match, prefix) => `${prefix}${INDEXER_OUTPUT_REDACTION_MARKER}`,
    count,
  );
  output = replaceWithCount(
    output,
    /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
    (_match, prefix) => `${prefix}${INDEXER_OUTPUT_REDACTION_MARKER}@`,
    count,
  );
  output = replaceWithCount(
    output,
    /([?&](?:access_token|refresh_token|api_key|password|secret)=)[^&#\s]+/giu,
    (_match, prefix) => `${prefix}${INDEXER_OUTPUT_REDACTION_MARKER}`,
    count,
  );
  const key = "(?:[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|credential|cookie)[A-Za-z0-9_.-]*|api[-_]?key|access[-_]?(?:key|token)|private[-_]?key|client[-_]?secret|authorization)";
  const assignment = "(?:=\\s*|:\\s+(?=\\S)|:\\s*(?=[\"']))";
  output = replaceWithCount(
    output,
    new RegExp(`((?:["']?${key}["']?)\\s*${assignment})(?:"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'|[^\\s,;}\\]]+)`, "giu"),
    (_match, prefix) => `${prefix}"${INDEXER_OUTPUT_REDACTION_MARKER}"`,
    count,
  );
  return output;
}

function redactBlockedText(
  value: string,
  blocked: readonly IndexerBlockedOutputScalar[],
  count: MutableCount,
): string {
  let output = value;
  for (const scalar of blocked) {
    const pattern = typeof scalar === "number"
      ? new RegExp(`(?<![0-9.])${escapeRegExp(String(scalar))}(?![0-9.])`, "gu")
      : new RegExp(escapeRegExp(scalar), "gu");
    output = replaceWithCount(output, pattern, INDEXER_OUTPUT_REDACTION_MARKER, count);
  }
  return output;
}

function redactText(
  value: string,
  blocked: readonly IndexerBlockedOutputScalar[],
  count: MutableCount,
): string {
  return redactBlockedText(redactKnownText(value, count), blocked, count);
}

function blockedScalar(
  value: unknown,
  blocked: readonly IndexerBlockedOutputScalar[],
): boolean {
  return blocked.some((candidate) => typeof candidate === typeof value && Object.is(candidate, value));
}

function redactStructured(
  value: unknown,
  blocked: readonly IndexerBlockedOutputScalar[],
  count: MutableCount,
  seen: WeakSet<object>,
): unknown {
  if (blockedScalar(value, blocked)) {
    count.replacements += 1;
    return INDEXER_OUTPUT_REDACTION_MARKER;
  }
  if (typeof value === "string") return redactText(value, blocked, count);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new TypeError("Indexer output redaction requires an acyclic value");
  seen.add(value);
  if (value instanceof Date) {
    const redacted = redactText(value.toISOString(), blocked, count);
    seen.delete(value);
    return redacted;
  }
  if (value instanceof Error) {
    const redacted = {
      name: redactText(value.name, blocked, count),
      message: redactText(value.message, blocked, count),
    };
    seen.delete(value);
    return redacted;
  }
  if (Array.isArray(value)) {
    const redacted = value.map((item) => redactStructured(item, blocked, count, seen));
    seen.delete(value);
    return redacted;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const safeKey = redactText(key, blocked, count);
    if (sensitiveKey(key, item)) {
      count.replacements += 1;
      redacted[safeKey] = INDEXER_OUTPUT_REDACTION_MARKER;
    } else {
      redacted[safeKey] = redactStructured(item, blocked, count, seen);
    }
  }
  seen.delete(value);
  return redacted;
}

export function redactIndexerOutput<T>(input: {
  channel: IndexerOutputChannel;
  value: T;
  policy?: IndexerOutputRedactionPolicy;
}): IndexerOutputRedactionResult<T> {
  const count = { replacements: 0 };
  const blocked = normalizedBlockedScalars(input.policy ?? {});
  const value = typeof input.value === "string"
    ? redactText(input.value, blocked, count)
    : redactStructured(input.value, blocked, count, new WeakSet());
  return {
    value: value as T,
    redacted: count.replacements > 0,
    replacement_count: count.replacements,
  };
}

export function redactIndexerOutputText(input: {
  channel: "stdout" | "stderr" | "exception-message";
  value: string;
  policy?: IndexerOutputRedactionPolicy;
}): string {
  return redactIndexerOutput(input).value;
}

export function assertIndexerOutputSafe<T>(input: {
  channel: "success-payload" | "ipc-envelope" | "review-sample" | "audit-report";
  value: T;
  policy?: IndexerOutputRedactionPolicy;
}): T {
  const result = redactIndexerOutput(input);
  if (result.redacted) {
    throw new TypeError(`Indexer ${input.channel} was blocked by the common output redaction boundary`);
  }
  return input.value;
}
