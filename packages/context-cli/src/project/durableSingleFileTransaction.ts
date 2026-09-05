import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { measureContextDebugOperation } from "./debugTrace.js";

const TRANSACTION_ROOT = join(".tmp", "context-runtime", "transactions");
const SAFE_KIND = /^[a-z][a-z0-9-]*$/u;

interface DurableSingleFileJournal {
  protocol: "context.durable-single-file-transaction/v1";
  kind: string;
  target_path: string;
  base_digest: string | null;
  target_digest: string;
  target_content: string;
}

export type DurableTransactionFailurePoint =
  | "after-journal-temp-write"
  | "after-journal-temp-fsync"
  | "after-journal-rename"
  | "after-journal-dir-fsync"
  | "after-target-write"
  | "after-target-fsync"
  | "after-target-rename"
  | "after-target-dir-fsync"
  | "after-journal-remove"
  | "after-journal-remove-dir-fsync";

export type DurableTransactionFailureInjector = (
  point: DurableTransactionFailurePoint,
) => void | Promise<void>;

export interface DurableSingleFileTransactionReceipt {
  protocol: "context.durable-single-file-transaction-receipt/v1";
  kind: string;
  target_path: string;
  base_digest: string | null;
  target_digest: string;
  recovered: boolean;
}

export function durableContentDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function journalPath(projectRoot: string, kind: string): string {
  if (!SAFE_KIND.test(kind)) throw new TypeError("transaction kind is invalid");
  return join(projectRoot, TRANSACTION_ROOT, `${kind}.journal.json`);
}

function resolveProjectPath(projectRoot: string, relPath: string): string {
  if (isAbsolute(relPath) || relPath.length === 0) {
    throw new TypeError("transaction target must be a non-empty relative path");
  }
  const root = resolve(projectRoot);
  const target = resolve(root, relPath);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new TypeError("transaction target escapes the project root");
  }
  return target;
}

async function readMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeSyncedFile(input: {
  path: string;
  content: string;
  inject_failure?: DurableTransactionFailureInjector;
  after_write?: DurableTransactionFailurePoint;
  after_fsync?: DurableTransactionFailurePoint;
}): Promise<void> {
  const { path, content } = input;
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "w");
  try {
    await handle.writeFile(content, "utf8");
    if (input.after_write !== undefined) {
      await input.inject_failure?.(input.after_write);
    }
    await handle.sync();
    if (input.after_fsync !== undefined) {
      await input.inject_failure?.(input.after_fsync);
    }
  } finally {
    await handle.close();
  }
}

async function persistJournal(input: {
  path: string;
  journal: DurableSingleFileJournal;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<void> {
  const { path, journal } = input;
  const content = `${JSON.stringify(journal, null, 2)}\n`;
  const tempPath = `${path}.tmp`;
  await writeSyncedFile({
    path: tempPath,
    content,
    ...(input.inject_failure === undefined
      ? {}
      : { inject_failure: input.inject_failure }),
    after_write: "after-journal-temp-write",
    after_fsync: "after-journal-temp-fsync",
  });
  await rename(tempPath, path);
  await input.inject_failure?.("after-journal-rename");
  await syncDirectory(dirname(path));
  await input.inject_failure?.("after-journal-dir-fsync");
}

async function removeJournal(input: {
  path: string;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<void> {
  const { path } = input;
  await rm(path, { force: true });
  await input.inject_failure?.("after-journal-remove");
  await syncDirectory(dirname(path));
  await input.inject_failure?.("after-journal-remove-dir-fsync");
}

function parseJournal(value: string, kind: string): DurableSingleFileJournal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new TypeError(`durable transaction journal ${kind} is invalid JSON`);
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) throw new TypeError(`durable transaction journal ${kind} is invalid`);
  const record = parsed as Record<string, unknown>;
  if (
    record.protocol !== "context.durable-single-file-transaction/v1" ||
    record.kind !== kind ||
    typeof record.target_path !== "string" ||
    (record.base_digest !== null && typeof record.base_digest !== "string") ||
    typeof record.target_digest !== "string" ||
    typeof record.target_content !== "string" ||
    durableContentDigest(record.target_content) !== record.target_digest
  ) throw new TypeError(`durable transaction journal ${kind} failed integrity validation`);
  return record as unknown as DurableSingleFileJournal;
}

async function commitJournalTarget(input: {
  projectRoot: string;
  journalPath: string;
  journal: DurableSingleFileJournal;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<void> {
  const targetPath = resolveProjectPath(input.projectRoot, input.journal.target_path);
  const targetTemp = `${targetPath}.transaction-${input.journal.kind}.tmp`;
  await writeSyncedFile({
    path: targetTemp,
    content: input.journal.target_content,
    ...(input.inject_failure === undefined
      ? {}
      : { inject_failure: input.inject_failure }),
    after_write: "after-target-write",
    after_fsync: "after-target-fsync",
  });
  await rename(targetTemp, targetPath);
  await input.inject_failure?.("after-target-rename");
  await syncDirectory(dirname(targetPath));
  await input.inject_failure?.("after-target-dir-fsync");
  await removeJournal({
    path: input.journalPath,
    ...(input.inject_failure === undefined
      ? {}
      : { inject_failure: input.inject_failure }),
  });
}

export async function recoverDurableSingleFileTransaction(input: {
  projectRoot: string;
  kind: string;
  expected_target_path?: string;
}): Promise<DurableSingleFileTransactionReceipt | undefined> {
  const path = journalPath(input.projectRoot, input.kind);
  const raw = await readMaybe(path);
  if (raw === undefined) return undefined;
  const journal = parseJournal(raw, input.kind);
  if (
    input.expected_target_path !== undefined &&
    journal.target_path !== input.expected_target_path
  ) throw new TypeError("durable transaction journal target does not match this operation");
  const targetPath = resolveProjectPath(input.projectRoot, journal.target_path);
  const current = await readMaybe(targetPath);
  const currentDigest = current === undefined ? null : durableContentDigest(current);
  if (currentDigest === journal.target_digest) {
    await removeJournal({ path });
  } else if (currentDigest === journal.base_digest) {
    await commitJournalTarget({
      projectRoot: input.projectRoot,
      journalPath: path,
      journal,
    });
  } else {
    throw new TypeError(
      `durable transaction ${input.kind} cannot recover from an unknown target state`,
    );
  }
  return {
    protocol: "context.durable-single-file-transaction-receipt/v1",
    kind: input.kind,
    target_path: journal.target_path,
    base_digest: journal.base_digest,
    target_digest: journal.target_digest,
    recovered: true,
  };
}

async function runDurableSingleFileTransactionInternal(input: {
  projectRoot: string;
  kind: string;
  target_path: string;
  expected_base_digest: string | null;
  target_content: string;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<DurableSingleFileTransactionReceipt> {
  await recoverDurableSingleFileTransaction({
    projectRoot: input.projectRoot,
    kind: input.kind,
    expected_target_path: input.target_path,
  });
  const targetPath = resolveProjectPath(input.projectRoot, input.target_path);
  const baseContent = await readMaybe(targetPath);
  const baseDigest = baseContent === undefined ? null : durableContentDigest(baseContent);
  if (baseDigest !== input.expected_base_digest) {
    throw new TypeError(`durable transaction ${input.kind} base CAS mismatch`);
  }
  const path = journalPath(input.projectRoot, input.kind);
  const journal: DurableSingleFileJournal = {
    protocol: "context.durable-single-file-transaction/v1",
    kind: input.kind,
    target_path: input.target_path,
    base_digest: baseDigest,
    target_digest: durableContentDigest(input.target_content),
    target_content: input.target_content,
  };
  await persistJournal({
    path,
    journal,
    ...(input.inject_failure === undefined
      ? {}
      : { inject_failure: input.inject_failure }),
  });
  await commitJournalTarget({
    projectRoot: input.projectRoot,
    journalPath: path,
    journal,
    ...(input.inject_failure === undefined
      ? {}
      : { inject_failure: input.inject_failure }),
  });
  return {
    protocol: "context.durable-single-file-transaction-receipt/v1",
    kind: input.kind,
    target_path: input.target_path,
    base_digest: baseDigest,
    target_digest: journal.target_digest,
    recovered: false,
  };
}

export async function runDurableSingleFileTransaction(input: {
  projectRoot: string;
  kind: string;
  target_path: string;
  expected_base_digest: string | null;
  target_content: string;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<DurableSingleFileTransactionReceipt> {
  return measureContextDebugOperation({
    projectRoot: input.projectRoot,
    operation: "durable-transaction.commit",
    counters: {
      durable_transaction_count: 1,
      durable_transaction_target_count: 1,
    },
    data: { transaction_kind: input.kind, transaction_shape: "single-file" },
  }, () => runDurableSingleFileTransactionInternal(input));
}
