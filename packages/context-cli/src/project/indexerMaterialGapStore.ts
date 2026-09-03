import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  validateIndexerMaterialGapLedger,
  type IndexerMaterialGapLedger,
} from "@c4a/context";
import {
  durableContentDigest,
  recoverDurableSingleFileTransaction,
  runDurableSingleFileTransaction,
  type DurableSingleFileTransactionReceipt,
  type DurableTransactionFailureInjector,
} from "./durableSingleFileTransaction.js";
import { LIFECYCLE_ROOT } from "./lifecyclePaths.js";
import { withProjectWriteLock } from "./writeLock.js";

export const INDEXER_MATERIAL_GAP_STATE_PATH = join(
  LIFECYCLE_ROOT,
  "indexer-material-gaps.json",
);

const CHECKPOINT_TRANSACTION = "checkpoint-material-gaps";

export interface IndexerMaterialGapWriteReceipt {
  protocol: "context.indexer.material-gap-write-receipt/v1";
  operation: "checkpoint-material-gaps";
  predecessor_ledger_revision: string | null;
  successor_ledger_revision: string;
  state_digest: string;
  transaction: DurableSingleFileTransactionReceipt;
}

async function recoverMaterialGapTransactionUnlocked(
  projectRoot: string,
): Promise<DurableSingleFileTransactionReceipt[]> {
  const receipt = await recoverDurableSingleFileTransaction({
    projectRoot,
    kind: CHECKPOINT_TRANSACTION,
    expected_target_path: INDEXER_MATERIAL_GAP_STATE_PATH,
  });
  return receipt === undefined ? [] : [receipt];
}

async function readLedgerUnlocked(
  projectRoot: string,
): Promise<IndexerMaterialGapLedger | undefined> {
  const path = join(projectRoot, INDEXER_MATERIAL_GAP_STATE_PATH);
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new TypeError(
      `material gap runtime state is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return validateIndexerMaterialGapLedger(parsed);
}

export async function recoverIndexerMaterialGapStore(
  projectRoot: string,
): Promise<DurableSingleFileTransactionReceipt[]> {
  return withProjectWriteLock(projectRoot, "recover-indexer-material-gap-store", () =>
    recoverMaterialGapTransactionUnlocked(projectRoot)
  );
}

export async function checkpointIndexerMaterialGapStore(input: {
  projectRoot: string;
  expected_ledger_revision: string | null;
  ledger: unknown;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<IndexerMaterialGapWriteReceipt> {
  return withProjectWriteLock(input.projectRoot, CHECKPOINT_TRANSACTION, async () => {
    await recoverMaterialGapTransactionUnlocked(input.projectRoot);
    const ledger = validateIndexerMaterialGapLedger(input.ledger);
    const previous = await readLedgerUnlocked(input.projectRoot);
    if ((previous?.revision ?? null) !== input.expected_ledger_revision) {
      throw new TypeError("material gap runtime checkpoint CAS mismatch");
    }
    const content = `${JSON.stringify(ledger, null, 2)}\n`;
    const transaction = await runDurableSingleFileTransaction({
      projectRoot: input.projectRoot,
      kind: CHECKPOINT_TRANSACTION,
      target_path: INDEXER_MATERIAL_GAP_STATE_PATH,
      expected_base_digest: previous === undefined
        ? null
        : durableContentDigest(`${JSON.stringify(previous, null, 2)}\n`),
      target_content: content,
      ...(input.inject_failure === undefined
        ? {}
        : { inject_failure: input.inject_failure }),
    });
    return {
      protocol: "context.indexer.material-gap-write-receipt/v1",
      operation: "checkpoint-material-gaps",
      predecessor_ledger_revision: previous?.revision ?? null,
      successor_ledger_revision: ledger.revision,
      state_digest: transaction.target_digest,
      transaction,
    };
  });
}

export async function readIndexerMaterialGapState(projectRoot: string): Promise<{
  ledger: IndexerMaterialGapLedger;
} | undefined> {
  return withProjectWriteLock(projectRoot, "read-indexer-material-gap-store", async () => {
    await recoverMaterialGapTransactionUnlocked(projectRoot);
    const ledger = await readLedgerUnlocked(projectRoot);
    return ledger === undefined ? undefined : { ledger };
  });
}

export async function clearIndexerMaterialGapState(projectRoot: string): Promise<void> {
  await withProjectWriteLock(projectRoot, "clear-indexer-material-gap-store", async () => {
    await recoverMaterialGapTransactionUnlocked(projectRoot);
    await rm(join(projectRoot, INDEXER_MATERIAL_GAP_STATE_PATH), { force: true });
  });
}
