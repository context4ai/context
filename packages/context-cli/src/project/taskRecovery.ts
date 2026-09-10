import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { indexerProtocolDigest } from "@c4a/context";
import { currentLedger } from "./indexerMainRunStoreRecords.js";
import { readRecoveryCheckpoint, recoveryText } from "./taskRecoveryCheckpoint.js";
import { withProjectWriteLock } from "./writeLock.js";
import { recoverDurableMultiFileTransactions, safeProjectTarget } from "./durableMultiFileTransaction.js";
import { contextWorkflowProviderPath } from "./workflow/workflowProvider.js";

export const RECOVERY_COMMAND = "context task recover --format json";
export const TRANSACTIONS_PATH = ".tmp/context-runtime/transactions";

/** Inventory journals by bytes, without interpreting/replaying them or loading
 * project code. The transaction engine is the only writer/recovery authority. */
export async function recoveryJournals(root: string) {
  const entries: Array<{ path: string; digest: string }> = [];
  async function visit(path: string, depth: number): Promise<void> {
    await safeProjectTarget(root, path);
    let stat;
    try { stat = await lstat(join(root, path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    if (stat.isSymbolicLink()) throw new TypeError("Recovery does not follow transaction symlinks.");
    if (stat.isDirectory()) {
      if (depth > 3) throw new TypeError("Unexpected transaction directory depth; preserve it for diagnosis.");
      for (const name of (await readdir(join(root, path))).sort()) await visit(`${path}/${name}`, depth + 1);
    } else if (stat.isFile()) entries.push({ path, digest: indexerProtocolDigest(await recoveryText(root, path)) });
  }
  await visit(TRANSACTIONS_PATH, 0);
  return entries;
}

export function recoveryResources() {
  try {
    const root = dirname(contextWorkflowProviderPath());
    const resources = { skill: join(root, "skills/recover-workspace/SKILL.md"),
      issue_template: join(root, "resources/templates/recovery-issue.md") };
    if (!Object.values(resources).every(path => existsSync(path))) throw new Error("Recovery resources are absent from this Provider.");
    return resources;
  } catch {
    return { unavailable: "Recovery resources are missing. Record a sanitized issue/YYYY-MM-DD-short-description.md with expected/actual behavior, versions, command shape, error code, attempted repairs and preserved work. Never attach credentials or raw source content." };
  }
}

/** Best effort, read-only and independent of normal status/Route evaluation. */
export async function inspectTaskRecovery(root: string) {
  const findings: Array<{ area: string; error: string }> = [];
  async function probe<T>(area: string, read: () => Promise<T>): Promise<T | null> {
    try { return await read(); } catch (error) {
      // Diagnostic details remain local; the Agent redacts before sharing a report.
      findings.push({ area, error: error instanceof Error ? error.message : String(error) }); return null;
    }
  }
  const ledger = await probe("task-ledger", () => currentLedger(root));
  const checkpoint = await probe("accepted-plan", () => readRecoveryCheckpoint(root));
  const journals = await probe("transactions", () => recoveryJournals(root));
  const lock = await probe("writer-lock", async () => {
    const text = await recoveryText(root, ".tmp/context-runtime/locks/project-write.lock/owner.json");
    return text === undefined ? null : JSON.parse(text) as unknown;
  });
  return { action: "recovery-inspected", resources: recoveryResources(), findings,
    tasks: ledger?.entries.map(entry => ({ workset_digest: entry.workset_digest, stage: entry.stage, state: entry.state })) ?? [],
    checkpoint: checkpoint ? { digest: checkpoint.digest, structure_revision: checkpoint.structure_revision,
      worksets: checkpoint.entries.map(entry => entry.workset_digest) } : null,
    transactions: journals, writer_lock: lock,
    actions: [
      ...(journals?.length ? [{ operation: "transactions", command: `${RECOVERY_COMMAND} --operation transactions` }] : []),
      ...(ledger?.entries.some(entry => entry.stage === "author") ? [{ operation: "author", command: `${RECOVERY_COMMAND} --operation author --workset <listed-digest> --instruction <correction>` }] : []),
      ...(checkpoint ? [{ operation: "plan", command: `${RECOVERY_COMMAND} --operation plan --workset <listed-digest> --instruction <correction>` }] : []),
    ],
    guidance: "Read the recovery skill. Preview impact before applying an authorized repair. Do not pass an old --workflow-revision. Do not delete locks/runtime files, replay accepted payloads or repeat an unchanged failed action. If no safe repair works, write a sanitized issue report using issue_template; retain current knowledge and output.",
  };
}

export async function recoverTaskTransactions(input: { projectRoot: string; apply?: boolean; plan_digest?: string }) {
  return withProjectWriteLock(input.projectRoot, "recover-task-transactions", async () => {
    const journals = await recoveryJournals(input.projectRoot);
    const effects: Array<{ path: string; operation: string }> = [];
    for (const journal of journals.filter(entry => entry.path.endsWith("/journal.json"))) {
      const value = JSON.parse((await recoveryText(input.projectRoot, journal.path))!) as { targets?: Array<{ path?: unknown; operation?: unknown }> };
      if (!Array.isArray(value.targets)) throw new TypeError("Transaction targets are unreadable; preserve the journal and write an issue report.");
      for (const target of value.targets) {
        if (typeof target.path !== "string" || !["write", "delete"].includes(String(target.operation))) throw new TypeError("Transaction target scope is invalid; preserve the journal for diagnosis.");
        effects.push({ path: target.path, operation: String(target.operation) });
      }
    }
    const revision = indexerProtocolDigest(journals);
    if (!input.apply) return { action: "preview", operation: "transactions", revision,
      journal_files: journals.map(entry => entry.path), affected_files: effects,
      effect: "Finish only journaled writes already started; these may include approved knowledge. This is completion of an interrupted transaction, not a rollback.",
      next: `${RECOVERY_COMMAND} --operation transactions --apply --plan-digest '${revision}'` };
    if (input.plan_digest !== revision) throw new TypeError("Transaction inventory changed; preview recovery again before applying.");
    const receipts = await recoverDurableMultiFileTransactions(input.projectRoot);
    return { action: "transactions-recovered", receipts, next: "context status --format json" };
  });
}
