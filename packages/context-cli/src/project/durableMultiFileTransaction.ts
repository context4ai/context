import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { indexerProtocolDigest, type IndexerProjectFileTarget } from "@c4a/context";
import { durableContentDigest } from "./durableSingleFileTransaction.js";

const TRANSACTION_ROOT = join(".tmp", "context-runtime", "transactions");
const TRANSACTION_DIR = /^sha256-[a-f0-9]{64}$/u;
const SAFE_KIND = /^[a-z][a-z0-9-]*$/u;

interface DurableMultiFileJournal {
  protocol: "context.durable-multi-file-transaction/v1";
  transaction_digest: string;
  kind: string;
  proposal_digest: string;
  targets: IndexerProjectFileTarget[];
  completed_targets: string[];
}
export type DurableMultiFileFailureInjector = (point: string) => void | Promise<void>;

export interface DurableMultiFileTransactionReceipt {
  protocol: "context.durable-multi-file-transaction-receipt/v1";
  transaction_digest: string;
  kind: string;
  proposal_digest: string;
  target_digests: Array<{ path: string; digest: string | null }>;
  recovered: boolean;
}

function transactionDigest(input: {
  kind: string;
  proposal_digest: string;
  targets: readonly IndexerProjectFileTarget[];
}): string {
  return indexerProtocolDigest({
    protocol: "context.durable-multi-file-transaction/v1",
    kind: input.kind,
    proposal_digest: input.proposal_digest,
    targets: input.targets,
  });
}

function transactionDirectory(projectRoot: string, digest: string): string {
  return join(projectRoot, TRANSACTION_ROOT, digest.replace(":", "-"));
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function readMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
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

async function safeProjectTarget(projectRoot: string, targetPath: string): Promise<string> {
  if (isAbsolute(targetPath) || targetPath.length === 0) {
    throw new TypeError("multi-file transaction target must be a relative path");
  }
  const root = resolve(projectRoot);
  const target = resolve(root, targetPath);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new TypeError("multi-file transaction target escapes the project root");
  }
  const segments = rel.split("/");
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const status = await lstat(current);
      if (status.isSymbolicLink()) {
        throw new TypeError(`multi-file transaction target crosses a symlink: ${targetPath}`);
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      break;
    }
  }
  return target;
}

async function currentDigest(projectRoot: string, target: IndexerProjectFileTarget): Promise<string | null> {
  const absolute = await safeProjectTarget(projectRoot, target.path);
  const content = await readMaybe(absolute);
  return content === undefined ? null : durableContentDigest(content);
}

function validateTargets(targets: readonly IndexerProjectFileTarget[]): void {
  if (targets.length === 0) throw new TypeError("multi-file transaction requires targets");
  const paths = targets.map((target) => target.path);
  const sorted = [...paths].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (
    new Set(paths).size !== paths.length ||
    paths.some((path, index) => path !== sorted[index])
  ) {
    throw new TypeError("multi-file transaction targets must be unique and canonically ordered");
  }
  for (const target of targets) {
    if (
      target.operation === "write" &&
      (target.content === undefined || target.target_digest !== durableContentDigest(target.content))
    ) {
      throw new TypeError(`multi-file transaction target payload is invalid: ${target.path}`);
    }
    if (
      target.operation === "delete" &&
      (target.content !== undefined || target.target_digest !== null)
    ) {
      throw new TypeError(`multi-file transaction delete target is invalid: ${target.path}`);
    }
  }
}

async function writeSynced(path: string, content: string, inject?: () => Promise<void>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "w");
  try {
    await handle.writeFile(content, "utf8");
    await inject?.();
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function persistJournal(input: {
  directory: string;
  journal: DurableMultiFileJournal;
  phase: "initial" | "progress";
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<void> {
  await mkdir(input.directory, { recursive: true });
  const path = join(input.directory, "journal.json");
  const temporary = `${path}.tmp`;
  await writeSynced(
    temporary,
    `${JSON.stringify(input.journal, null, 2)}\n`,
    async () => input.inject_failure?.(`after-${input.phase}-journal-write`),
  );
  await input.inject_failure?.(`after-${input.phase}-journal-fsync`);
  await rename(temporary, path);
  await input.inject_failure?.(`after-${input.phase}-journal-rename`);
  await syncDirectory(input.directory);
  await input.inject_failure?.(`after-${input.phase}-journal-dir-fsync`);
}

function parseJournal(raw: string, directoryName: string): DurableMultiFileJournal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError("multi-file transaction journal is invalid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("multi-file transaction journal is invalid");
  }
  const journal = parsed as DurableMultiFileJournal;
  if (
    journal.protocol !== "context.durable-multi-file-transaction/v1" ||
    typeof journal.transaction_digest !== "string" ||
    typeof journal.kind !== "string" ||
    !SAFE_KIND.test(journal.kind) ||
    typeof journal.proposal_digest !== "string" ||
    !Array.isArray(journal.targets) ||
    !Array.isArray(journal.completed_targets)
  ) {
    throw new TypeError("multi-file transaction journal has an invalid schema");
  }
  validateTargets(journal.targets);
  const expected = transactionDigest(journal);
  if (
    journal.transaction_digest !== expected ||
    directoryName !== expected.replace(":", "-") ||
    journal.completed_targets.some((path) =>
      !journal.targets.some((target) => target.path === path)
    ) ||
    new Set(journal.completed_targets).size !== journal.completed_targets.length
  ) {
    throw new TypeError("multi-file transaction journal failed integrity validation");
  }
  return journal;
}

async function writeTarget(input: {
  projectRoot: string;
  target: IndexerProjectFileTarget;
  transaction_digest: string;
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<void> {
  const absolute = await safeProjectTarget(input.projectRoot, input.target.path);
  await mkdir(dirname(absolute), { recursive: true });
  if (input.target.operation === "delete") {
    await rm(absolute, { force: true });
    await input.inject_failure?.(`after-target-delete:${input.target.path}`);
  } else {
    const temporary = `${absolute}.context-${input.transaction_digest.slice(7, 23)}.tmp`;
    await writeSynced(
      temporary,
      input.target.content!,
      async () => input.inject_failure?.(`after-target-write:${input.target.path}`),
    );
    await input.inject_failure?.(`after-target-fsync:${input.target.path}`);
    await rename(temporary, absolute);
    await input.inject_failure?.(`after-target-rename:${input.target.path}`);
  }
  await syncDirectory(dirname(absolute));
  await input.inject_failure?.(`after-target-dir-fsync:${input.target.path}`);
}

async function assertRecoverableStates(input: {
  projectRoot: string;
  journal: DurableMultiFileJournal;
}): Promise<void> {
  for (const target of input.journal.targets) {
    const current = await currentDigest(input.projectRoot, target);
    if (current !== target.base_digest && current !== target.target_digest) {
      throw new TypeError(`multi-file transaction target has unknown state: ${target.path}`);
    }
  }
}

async function commitJournal(input: {
  projectRoot: string;
  directory: string;
  journal: DurableMultiFileJournal;
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<void> {
  await assertRecoverableStates(input);
  for (const target of input.journal.targets) {
    const current = await currentDigest(input.projectRoot, target);
    if (current !== target.target_digest) {
      await writeTarget({
        projectRoot: input.projectRoot,
        target,
        transaction_digest: input.journal.transaction_digest,
        ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
      });
    }
  }
  await rm(input.directory, { recursive: true, force: true });
  await input.inject_failure?.("after-transaction-remove");
  await syncDirectory(dirname(input.directory));
  await input.inject_failure?.("after-transaction-remove-dir-fsync");
}

function receipt(journal: DurableMultiFileJournal, recovered: boolean): DurableMultiFileTransactionReceipt {
  return {
    protocol: "context.durable-multi-file-transaction-receipt/v1",
    transaction_digest: journal.transaction_digest,
    kind: journal.kind,
    proposal_digest: journal.proposal_digest,
    target_digests: journal.targets.map((target) => ({
      path: target.path,
      digest: target.target_digest,
    })),
    recovered,
  };
}

export async function recoverDurableMultiFileTransactions(
  projectRoot: string,
): Promise<DurableMultiFileTransactionReceipt[]> {
  const root = join(projectRoot, TRANSACTION_ROOT);
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const receipts: DurableMultiFileTransactionReceipt[] = [];
  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : 1)) {
    if (!entry.isDirectory() || !TRANSACTION_DIR.test(entry.name)) continue;
    const directory = join(root, entry.name);
    const raw = await readMaybe(join(directory, "journal.json"));
    if (raw === undefined) {
      await rm(directory, { recursive: true, force: true });
      continue;
    }
    const journal = parseJournal(raw, entry.name);
    await commitJournal({ projectRoot, directory, journal });
    receipts.push(receipt(journal, true));
  }
  return receipts;
}

export async function runDurableMultiFileTransaction(input: {
  projectRoot: string;
  kind: string;
  proposal_digest: string;
  targets: readonly IndexerProjectFileTarget[];
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<DurableMultiFileTransactionReceipt> {
  if (!SAFE_KIND.test(input.kind)) throw new TypeError("multi-file transaction kind is invalid");
  await recoverDurableMultiFileTransactions(input.projectRoot);
  validateTargets(input.targets);
  for (const target of input.targets) {
    if (await currentDigest(input.projectRoot, target) !== target.base_digest) {
      throw new TypeError(`multi-file transaction base CAS mismatch: ${target.path}`);
    }
  }
  const digest = transactionDigest(input);
  const directory = transactionDirectory(input.projectRoot, digest);
  const journal: DurableMultiFileJournal = {
    protocol: "context.durable-multi-file-transaction/v1",
    transaction_digest: digest,
    kind: input.kind,
    proposal_digest: input.proposal_digest,
    targets: [...input.targets],
    completed_targets: [],
  };
  await persistJournal({
    directory,
    journal,
    phase: "initial",
    ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
  });
  await commitJournal({
    projectRoot: input.projectRoot,
    directory,
    journal,
    ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
  });
  return receipt(journal, false);
}
