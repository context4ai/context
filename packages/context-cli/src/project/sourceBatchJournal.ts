import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

const INPUT_SCHEMA = "context.source-batch.input.v1";
const STATE_SCHEMA = "context.source-batch.state.v1";
const RUNTIME_PARTS = [".tmp", "context-runtime", "source-batches"];
const JOB_ID_PATTERN = /^[a-f0-9]{32}$/u;
const PHASES = new Set(["queued", "running", "failed", "completed", "interrupted"]);

export type SourceBatchJournalPhase = "queued" | "running" | "failed" | "completed" | "interrupted";

export interface SourceBatchJournal {
  projectRoot: string;
  jobId: string;
  namespace: string;
  /** Revalidate with the source batch parser and replay all items against the current registry. */
  items: readonly unknown[];
  inputDigest: string;
  inputPath: string;
  statePath: string;
  resumeCommand: string;
}

export interface SourceBatchJournalProgress {
  phase: SourceBatchJournalPhase;
  committed_count: number;
  failed_index?: number;
}

interface SourceBatchJournalState extends SourceBatchJournalProgress {
  schema: typeof STATE_SCHEMA;
  job_id: string;
  input_digest: string;
  total: number;
  pid: number;
  updated_at: string;
}

function journalError(reason: string, message: string): ContextError {
  return new ContextError(ExitCode.WorkspaceStateError, message, {
    category: ErrorCategory.WorkspaceStateInvalid,
    reason_code: reason,
    next_action: {
      kind: "restore-source-batch-input",
      message: "Use the original batch input with context source add batch --checkpoint. Do not edit checkpoint files or skip items based on saved progress.",
    },
  });
}

function ioCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof ContextError ? String(error.detail?.reason_code ?? "invalid-checkpoint") : "unavailable";
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw journalError("source-batch-input-invalid", "Source batch checkpoint input must contain JSON values only.");
}

function inputDigest(namespace: string, items: readonly unknown[]): string {
  return `sha256:${createHash("sha256").update(canonicalJson({ schema: INPUT_SCHEMA, namespace, items })).digest("hex")}`;
}

function assertNamespace(namespace: unknown): asserts namespace is string {
  if (typeof namespace !== "string" || !/^\d{8}$/u.test(namespace)) {
    throw journalError("source-batch-input-invalid", "Source batch checkpoint namespace must be a YYYYMMDD date.");
  }
  const date = new Date(`${namespace.slice(0, 4)}-${namespace.slice(4, 6)}-${namespace.slice(6)}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10).replaceAll("-", "") !== namespace) {
    throw journalError("source-batch-input-invalid", "Source batch checkpoint namespace must be a valid YYYYMMDD date.");
  }
}

function paths(projectRoot: string, jobId: string): { inputPath: string; statePath: string } {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw journalError("source-batch-id-invalid", "Source batch checkpoint ID must contain exactly 32 lowercase hexadecimal characters.");
  }
  const directory = resolve(projectRoot, ...RUNTIME_PARTS, jobId);
  return { inputPath: join(directory, "input.json"), statePath: join(directory, "state.json") };
}

/** Reject symlink redirects below the workspace. Call mutations while holding its existing write lock. */
async function assertJournalPath(projectRoot: string, jobId: string, filename: "input.json" | "state.json"): Promise<void> {
  paths(projectRoot, jobId);
  let current = resolve(projectRoot);
  const parts = [...RUNTIME_PARTS, jobId, filename];
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (ioCode(error) === "ENOENT") return;
      throw error;
    }
    const validKind = index === parts.length - 1 ? stat.isFile() : stat.isDirectory();
    if (stat.isSymbolicLink() || !validKind) {
      throw journalError("source-batch-path-invalid", "Source batch checkpoint path must use regular files and workspace directories without symbolic links.");
    }
  }
}

function handle(projectRoot: string, namespace: string, items: readonly unknown[], digest: string): SourceBatchJournal {
  const jobId = digest.slice("sha256:".length, "sha256:".length + 32);
  return {
    projectRoot: resolve(projectRoot), jobId, namespace, items, inputDigest: digest,
    ...paths(projectRoot, jobId),
    resumeCommand: `context source add batch --resume ${jobId} --format json`,
  };
}

export async function loadSourceBatchJournal(input: { projectRoot: string; jobId: string }): Promise<SourceBatchJournal> {
  const { inputPath } = paths(input.projectRoot, input.jobId);
  try {
    await assertJournalPath(input.projectRoot, input.jobId, "input.json");
    const stored: unknown = JSON.parse(await readFile(inputPath, "utf8"));
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
      throw journalError("source-batch-input-invalid", "Source batch checkpoint input must be an object.");
    }
    const record = stored as Record<string, unknown>;
    if (record.schema !== INPUT_SCHEMA || !Array.isArray(record.items) || record.items.length === 0 ||
        Object.keys(record).some((key) => !["schema", "namespace", "items", "input_digest"].includes(key))) {
      throw journalError("source-batch-input-invalid", "Source batch checkpoint input has an invalid schema or empty items.");
    }
    assertNamespace(record.namespace);
    const digest = inputDigest(record.namespace, record.items);
    const journal = handle(input.projectRoot, record.namespace, record.items, digest);
    if (record.input_digest !== digest || journal.jobId !== input.jobId) {
      throw journalError("source-batch-input-changed", "Source batch checkpoint input does not match its original digest and ID.");
    }
    return journal;
  } catch (error) {
    if (error instanceof ContextError) throw error;
    throw journalError("source-batch-input-unavailable", `Cannot read source batch checkpoint input (${ioCode(error)}).`);
  }
}

function stateFor(journal: SourceBatchJournal, progress: SourceBatchJournalProgress): SourceBatchJournalState {
  const total = journal.items.length;
  if (!PHASES.has(progress.phase) || !Number.isSafeInteger(progress.committed_count) ||
      progress.committed_count < 0 || progress.committed_count > total ||
      (progress.phase === "completed" && progress.committed_count !== total) ||
      (progress.failed_index !== undefined && (!Number.isSafeInteger(progress.failed_index) || progress.failed_index < 0 || progress.failed_index >= total))) {
    throw journalError("source-batch-state-invalid", "Source batch checkpoint progress contains invalid counts or phase.");
  }
  return {
    schema: STATE_SCHEMA, job_id: journal.jobId, input_digest: journal.inputDigest,
    phase: progress.phase, committed_count: progress.committed_count, total,
    ...(progress.failed_index !== undefined && progress.phase === "failed" ? { failed_index: progress.failed_index } : {}),
    pid: process.pid, updated_at: new Date().toISOString(),
  };
}

async function writeState(journal: SourceBatchJournal, progress: SourceBatchJournalProgress): Promise<void> {
  await assertJournalPath(journal.projectRoot, journal.jobId, "state.json");
  await atomicWriteFile(journal.statePath, `${JSON.stringify(stateFor(journal, progress))}\n`);
}

/** Explicit opt-in initialization happens before any source registry mutation. */
export async function prepareSourceBatchJournal(input: {
  projectRoot: string; namespace: string; items: readonly unknown[];
}): Promise<SourceBatchJournal> {
  assertNamespace(input.namespace);
  if (input.items.length === 0) throw journalError("source-batch-input-invalid", "Source batch checkpoint input requires at least one item.");
  const journal = handle(input.projectRoot, input.namespace, input.items, inputDigest(input.namespace, input.items));
  try {
    await assertJournalPath(journal.projectRoot, journal.jobId, "input.json");
    let exists = true;
    try { await lstat(journal.inputPath); } catch (error) {
      if (ioCode(error) !== "ENOENT") throw error;
      exists = false;
    }
    if (exists) {
      await loadSourceBatchJournal({ projectRoot: journal.projectRoot, jobId: journal.jobId });
    } else {
      await atomicWriteFile(journal.inputPath, `${JSON.stringify({
        schema: INPUT_SCHEMA, namespace: journal.namespace, items: journal.items, input_digest: journal.inputDigest,
      })}\n`);
    }
    await writeState(journal, { phase: "queued", committed_count: 0 });
    return journal;
  } catch (error) {
    if (error instanceof ContextError) throw error;
    throw journalError("source-batch-checkpoint-unavailable", `Cannot initialize source batch checkpoint (${ioCode(error)}). No source registration has started.`);
  }
}

/** Progress is advisory: loss of this file must never turn a committed source registration into a failure. */
export async function updateSourceBatchJournal(
  journal: SourceBatchJournal,
  progress: SourceBatchJournalProgress,
): Promise<string | undefined> {
  try {
    await writeState(journal, progress);
    return undefined;
  } catch (error) {
    return `Source batch checkpoint progress could not be saved (${ioCode(error)}). Registration receipts remain authoritative; resume rechecks every input item.`;
  }
}

export function sourceBatchJournalReceipt(journal: SourceBatchJournal): Record<string, unknown> {
  return {
    job_id: journal.jobId, namespace: journal.namespace, total: journal.items.length,
    input_path: journal.inputPath, state_path: journal.statePath,
    registration_only: true, resume_command: journal.resumeCommand,
    status_command: `context source batch-status ${journal.jobId} --format json`,
  };
}

/** This does not inspect or modify write locks, or infer completion from a live/dead PID. */
export async function readSourceBatchJournalStatus(input: { projectRoot: string; jobId: string }): Promise<Record<string, unknown>> {
  const journal = await loadSourceBatchJournal(input);
  let state: SourceBatchJournalState | undefined;
  let warning: string | undefined;
  try {
    await assertJournalPath(journal.projectRoot, journal.jobId, "state.json");
    const parsed = JSON.parse(await readFile(journal.statePath, "utf8")) as SourceBatchJournalState;
    if (parsed.schema !== STATE_SCHEMA || parsed.job_id !== journal.jobId || parsed.input_digest !== journal.inputDigest ||
        parsed.total !== journal.items.length || !Number.isSafeInteger(parsed.pid) || parsed.pid <= 0 ||
        typeof parsed.updated_at !== "string" || !Number.isFinite(Date.parse(parsed.updated_at))) {
      throw journalError("source-batch-state-invalid", "Source batch checkpoint progress is invalid.");
    }
    const validated = stateFor(journal, parsed);
    state = { ...validated, pid: parsed.pid, updated_at: parsed.updated_at };
  } catch (error) {
    warning = `Saved progress is unavailable (${ioCode(error)}). Resume will validate and replay all input items.`;
  }
  return {
    kind: "source.registration.batch.status", ...sourceBatchJournalReceipt(journal),
    progress_is_advisory: true,
    ...(state === undefined ? { phase: "unknown" } : {
      phase: state.phase, committed_count: state.committed_count,
      ...(state.failed_index === undefined ? {} : { failed_index: state.failed_index }),
      pid: state.pid, updated_at: state.updated_at,
    }),
    ...(warning === undefined ? {} : { warnings: [warning] }),
  };
}
