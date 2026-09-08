import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { join } from "node:path";
import YAML from "yaml";
import { atomicWriteFile } from "../lib/atomicWrite.js";

const INLINE_LIMIT = 16 * 1024;
const MAX_OUTCOMES = 20;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function pick(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

function shortText(value: unknown, limit = 400): string | undefined {
  return typeof value === "string" ? value.length > limit ? `${value.slice(0, limit)}…` : value : undefined;
}

export function serializeActionCompletion(value: unknown, format: "json" | "yaml"): string {
  return format === "json" ? `${JSON.stringify(value, null, 2)}\n` : YAML.stringify(value);
}

/** Keep transport output bounded without losing committed outcomes or the next Route. */
export async function prepareActionCompletionOutput(input: {
  projectRoot: string;
  result: unknown;
  format: "json" | "yaml";
  verbose?: boolean;
}): Promise<unknown> {
  if (input.verbose) return input.result;
  const result = record(input.result);
  if (result === undefined) return input.result;
  const full = serializeActionCompletion(result, "json");
  const digest = createHash("sha256").update(full).digest("hex");
  const root = join(input.projectRoot, ".tmp/context-runtime/action-results");
  const resultFile = join(root, `${digest}.json`);
  await atomicWriteFile(resultFile, full);
  const next = record(result.next);
  const nextFile = next === undefined ? undefined : join(root, `${digest}.next.json`);
  if (nextFile !== undefined) await atomicWriteFile(nextFile, serializeActionCompletion(next, "json"));
  const outcomes = (Array.isArray(result.outcomes) ? result.outcomes : [])
    .map(record).filter((item): item is Record<string, unknown> => item !== undefined);
  const counts: Record<string, number> = {};
  for (const item of outcomes) {
    const key = typeof item.outcome === "string" ? item.outcome : "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const progress = record(result.progress);
  const failure = record(result.next_preparation);
  const summary = {
    protocol: "context.action.completion-summary/v1",
    completion_protocol: result.protocol,
    ...pick(result, ["stage", "outcome", "current_revision", "revision_before", "revision_after", "revision_advanced"]),
    result_file: resultFile,
    result_bytes: Buffer.byteLength(full),
    outcome_counts: counts,
    ...pick(result, ["workflow_summary", "composer_result"]),
    committed_count: Array.isArray(result.outcomes) ? outcomes.filter((item) => item.committed === true).length : null,
    outcomes: outcomes.slice(0, MAX_OUTCOMES).map((item) => ({
      ...pick(item, ["task_key", "outcome", "committed"]),
      ...(item.message === undefined ? {} : { message: shortText(item.message) }),
    })),
    outcomes_omitted: Math.max(0, outcomes.length - MAX_OUTCOMES),
    progress: progress === undefined ? null : pick(progress, [
      "stage", "total", "accepted", "running", "pending", "failed", "stale", "stop", "workflow_progress", "task_completion", "pages",
    ]),
    next_route: next === undefined ? null : {
      file: nextFile, digest: `sha256:${createHash("sha256").update(serializeActionCompletion(next, "json")).digest("hex")}`, ...pick(next, ["revision", "node", "availability"]),
      commands: next.commands, gate: next.gate === undefined ? undefined : pick(record(next.gate)!, ["id", "resolution", "delegatable"]),
    },
    ...(failure === undefined ? {} : { next_preparation: {
      outcome: failure.outcome, message: shortText(failure.message), command: failure.command,
    } }),
    guidance: "Read result_file for full diagnostics and next_route.file for the exact next Route. Do not resubmit committed tasks. Long messages are shortened only in this summary.",
  };
  // An unusually large individual diagnostic must not defeat the output limit.
  while (summary.outcomes.length > 0 && Buffer.byteLength(serializeActionCompletion(summary, input.format)) > INLINE_LIMIT) {
    summary.outcomes.pop();
    summary.outcomes_omitted++;
  }
  return summary;
}
