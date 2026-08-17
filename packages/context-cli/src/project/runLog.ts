import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PhaseDefinition } from "@c4a/context";

export interface PhaseRunLogInput {
  projectRoot: string;
  runId: string;
  phase: Pick<PhaseDefinition, "id" | "kind">;
  dryRun: boolean;
  reads: readonly string[];
  writes: readonly string[];
  status: "success" | "failed";
  startedAt: string;
  durationMs: number;
  summary?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    detail?: Record<string, unknown>;
  };
}

export const createPhaseRunId = (): string => {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "");
  return `run_${timestamp}_${randomUUID().slice(0, 8)}`;
};

export async function writePhaseRunLog(input: PhaseRunLogInput): Promise<string> {
  const relPath = join(".tmp", "context-runtime", "runs", `${input.runId}.json`);
  const absPath = join(input.projectRoot, relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify({
    run_id: input.runId,
    phase_id: input.phase.id,
    phase_kind: input.phase.kind,
    dry_run: input.dryRun,
    reads: input.reads,
    writes: input.writes,
    status: input.status,
    started_at: input.startedAt,
    duration_ms: input.durationMs,
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.error ? { error: input.error } : {}),
  }, null, 2)}\n`, "utf8");
  return relPath;
}
