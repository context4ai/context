import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { indexerProtocolDigest } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { currentLedger, currentSpec } from "./indexerMainRunStoreRecords.js";
import { partitionAuthorBinding } from "./indexerPartitionStream.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";

export const RECOVERY_ROOT = ".tmp/context-runtime/indexer/recovery";
export const CHECKPOINT_PATH = `${RECOVERY_ROOT}/accepted-plan.json`;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const schema = z.object({
  protocol: z.literal("context.recovery-plan/v1"),
  structure_revision: digest,
  guard: digest,
  entries: z.array(z.object({ workset_digest: digest, request_digest: digest, binding: digest }).strict()),
  digest,
}).strict();

export async function recoveryText(root: string, path: string): Promise<string | undefined> {
  await safeProjectTarget(root, path);
  try { return await readFile(join(root, path), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Registered versions and approved identities, never a new scan of source checkouts.
 * Refuse restoring a planning baseline after publication/configuration changes;
 * normal per-page revision remains available in that case. */
export async function recoveryBaselineGuard(root: string): Promise<string> {
  const paths = ["src/index.ts", "src/indexers.yaml", "package.json", "knowledge/structure.yaml",
    ...["repo", "lark", "file", "note", "sessions"].map(kind => `sources/${kind}/index.yaml`)];
  const values = await Promise.all(paths.map(async path => [path, await recoveryText(root, path) ?? null]));
  return indexerProtocolDigest(values);
}

/** Keep only the active accepted plan; immutable requests/templates are already
 * retained in the run store. Lifecycle cleanup removes this reference manifest. */
export async function saveRecoveryCheckpoint(root: string, revision: string): Promise<void> {
  const existing = await readRecoveryCheckpoint(root);
  if (existing?.structure_revision === revision) return;
  const ledger = await currentLedger(root);
  if (!ledger?.entries.length || ledger.entries.some(entry => entry.stage !== "author")) return;
  const entries = await Promise.all(ledger.entries.map(async entry => {
    const spec = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
    return { workset_digest: entry.workset_digest, request_digest: entry.execution_request_digest,
      binding: partitionAuthorBinding(spec) };
  }));
  const value = { protocol: "context.recovery-plan/v1" as const, structure_revision: revision,
    guard: await recoveryBaselineGuard(root), entries };
  await safeProjectTarget(root, CHECKPOINT_PATH);
  await atomicWriteFile(join(root, CHECKPOINT_PATH), JSON.stringify({ ...value, digest: indexerProtocolDigest(value) }));
}

export async function readRecoveryCheckpoint(root: string) {
  const text = await recoveryText(root, CHECKPOINT_PATH);
  if (text === undefined) return undefined;
  const value = schema.parse(JSON.parse(text));
  const { digest: actual, ...payload } = value;
  if (indexerProtocolDigest(payload) !== actual) throw new TypeError("Recovery checkpoint digest mismatch; preserve it for diagnosis.");
  return value;
}
