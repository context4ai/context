import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  validateIndexerMaterialGapLedger,
  type IndexerMaterialGapLedger,
} from "@c4a/context";
import YAML from "yaml";
import {
  durableContentDigest,
  recoverDurableSingleFileTransaction,
  runDurableSingleFileTransaction,
  type DurableSingleFileTransactionReceipt,
  type DurableTransactionFailureInjector,
} from "./durableSingleFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

export const INDEXER_APPROVED_STRUCTURE_PATH = join("knowledge", "structure.yaml");
export const INDEXER_APPROVED_STRUCTURE_SCHEMA = "context.approved-structure.v1";

const CHECKPOINT_TRANSACTION = "checkpoint-material-gaps";
const CLOSE_TRANSACTION = "close-approved-knowledge";

type StructureState = "retained-state-present" | "approved-projection-closed";

interface StructureRecord extends Record<string, unknown> {
  schema_version: string;
  structure_state?: StructureState;
  material_gap_ledger?: unknown;
}

export interface IndexerMaterialGapWriteReceipt {
  protocol: "context.indexer.material-gap-write-receipt/v1";
  operation: "checkpoint-material-gaps" | "close-approved-knowledge";
  structure_path: string;
  predecessor_ledger_revision: string | null;
  successor_ledger_revision: string;
  structure_digest: string;
  transaction: DurableSingleFileTransactionReceipt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readStructure(projectRoot: string): Promise<{
  content: string | undefined;
  record: StructureRecord | undefined;
}> {
  const path = join(projectRoot, INDEXER_APPROVED_STRUCTURE_PATH);
  if (!existsSync(path)) return { content: undefined, record: undefined };
  const content = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = YAML.parse(content) as unknown;
  } catch (error) {
    throw new TypeError(
      `knowledge/structure.yaml is invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed) || parsed.schema_version !== INDEXER_APPROVED_STRUCTURE_SCHEMA) {
    throw new TypeError("knowledge/structure.yaml does not use the supported structure schema");
  }
  return { content, record: parsed as StructureRecord };
}

function currentLedger(record: StructureRecord | undefined): IndexerMaterialGapLedger | undefined {
  return record?.material_gap_ledger === undefined
    ? undefined
    : validateIndexerMaterialGapLedger(record.material_gap_ledger);
}

function assertLedgerCas(input: {
  current: IndexerMaterialGapLedger | undefined;
  expected_revision: string | null;
}): void {
  const currentRevision = input.current?.revision ?? null;
  if (currentRevision !== input.expected_revision) {
    throw new TypeError("material gap structure checkpoint CAS mismatch");
  }
}

function approvedProjectionPresent(record: StructureRecord | undefined): boolean {
  return record !== undefined &&
    typeof record.input_hash === "string" &&
    Array.isArray(record.nodes) &&
    Array.isArray(record.views) &&
    Array.isArray(record.edges);
}

function minimalRetainedStructure(input: {
  ledger: IndexerMaterialGapLedger;
  source_inputs?: Record<string, Record<string, string>>;
}): StructureRecord {
  return {
    schema_version: INDEXER_APPROVED_STRUCTURE_SCHEMA,
    structure_state: "retained-state-present",
    nodes: [],
    views: [],
    edges: [],
    ...(input.source_inputs === undefined ? {} : { source_inputs: input.source_inputs }),
    material_gap_ledger: input.ledger,
  };
}

async function recoverMaterialGapTransactionsUnlocked(
  projectRoot: string,
): Promise<DurableSingleFileTransactionReceipt[]> {
  const receipts: DurableSingleFileTransactionReceipt[] = [];
  for (const kind of [CHECKPOINT_TRANSACTION, CLOSE_TRANSACTION]) {
    const receipt = await recoverDurableSingleFileTransaction({
      projectRoot,
      kind,
      expected_target_path: INDEXER_APPROVED_STRUCTURE_PATH,
    });
    if (receipt !== undefined) receipts.push(receipt);
  }
  return receipts;
}

export async function recoverIndexerMaterialGapStore(
  projectRoot: string,
): Promise<DurableSingleFileTransactionReceipt[]> {
  return withProjectWriteLock(projectRoot, "recover-indexer-material-gap-store", () =>
    recoverMaterialGapTransactionsUnlocked(projectRoot)
  );
}

async function checkpointMaterialGapsUnlocked(input: {
  projectRoot: string;
  expected_ledger_revision: string | null;
  ledger: unknown;
  source_inputs?: Record<string, Record<string, string>>;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<IndexerMaterialGapWriteReceipt> {
  await recoverMaterialGapTransactionsUnlocked(input.projectRoot);
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  const current = await readStructure(input.projectRoot);
  const previousLedger = currentLedger(current.record);
  assertLedgerCas({
    current: previousLedger,
    expected_revision: input.expected_ledger_revision,
  });
  const target = current.record === undefined
    ? minimalRetainedStructure({
        ledger,
        ...(input.source_inputs === undefined ? {} : { source_inputs: input.source_inputs }),
      })
    : {
        ...current.record,
        structure_state: approvedProjectionPresent(current.record)
          ? "approved-projection-closed" as const
          : "retained-state-present" as const,
        material_gap_ledger: ledger,
      };
  const targetContent = YAML.stringify(target);
  const transaction = await runDurableSingleFileTransaction({
    projectRoot: input.projectRoot,
    kind: CHECKPOINT_TRANSACTION,
    target_path: INDEXER_APPROVED_STRUCTURE_PATH,
    expected_base_digest:
      current.content === undefined ? null : durableContentDigest(current.content),
    target_content: targetContent,
    ...(input.inject_failure === undefined
      ? {}
      : { inject_failure: input.inject_failure }),
  });
  return {
    protocol: "context.indexer.material-gap-write-receipt/v1",
    operation: "checkpoint-material-gaps",
    structure_path: INDEXER_APPROVED_STRUCTURE_PATH,
    predecessor_ledger_revision: previousLedger?.revision ?? null,
    successor_ledger_revision: ledger.revision,
    structure_digest: transaction.target_digest,
    transaction,
  };
}

export async function checkpointIndexerMaterialGapStore(input: {
  projectRoot: string;
  expected_ledger_revision: string | null;
  ledger: unknown;
  source_inputs?: Record<string, Record<string, string>>;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<IndexerMaterialGapWriteReceipt> {
  return withProjectWriteLock(input.projectRoot, CHECKPOINT_TRANSACTION, () =>
    checkpointMaterialGapsUnlocked(input)
  );
}

async function closeApprovedKnowledgeUnlocked(input: {
  projectRoot: string;
  expected_ledger_revision: string | null;
  ledger: unknown;
  approved_structure: Record<string, unknown>;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<IndexerMaterialGapWriteReceipt> {
  await recoverMaterialGapTransactionsUnlocked(input.projectRoot);
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  const current = await readStructure(input.projectRoot);
  const previousLedger = currentLedger(current.record);
  assertLedgerCas({
    current: previousLedger,
    expected_revision: input.expected_ledger_revision,
  });
  if (
    input.approved_structure.schema_version !== INDEXER_APPROVED_STRUCTURE_SCHEMA ||
    typeof input.approved_structure.input_hash !== "string" ||
    !Array.isArray(input.approved_structure.nodes) ||
    !Array.isArray(input.approved_structure.views) ||
    !Array.isArray(input.approved_structure.edges) ||
    input.approved_structure.material_gap_ledger !== undefined ||
    input.approved_structure.structure_state !== undefined
  ) {
    throw new TypeError("close requires a complete approved structure projection");
  }
  const target: StructureRecord = {
    ...input.approved_structure,
    schema_version: INDEXER_APPROVED_STRUCTURE_SCHEMA,
    structure_state: "approved-projection-closed",
    material_gap_ledger: ledger,
  };
  const targetContent = YAML.stringify(target);
  const transaction = await runDurableSingleFileTransaction({
    projectRoot: input.projectRoot,
    kind: CLOSE_TRANSACTION,
    target_path: INDEXER_APPROVED_STRUCTURE_PATH,
    expected_base_digest:
      current.content === undefined ? null : durableContentDigest(current.content),
    target_content: targetContent,
    ...(input.inject_failure === undefined
      ? {}
      : { inject_failure: input.inject_failure }),
  });
  return {
    protocol: "context.indexer.material-gap-write-receipt/v1",
    operation: "close-approved-knowledge",
    structure_path: INDEXER_APPROVED_STRUCTURE_PATH,
    predecessor_ledger_revision: previousLedger?.revision ?? null,
    successor_ledger_revision: ledger.revision,
    structure_digest: transaction.target_digest,
    transaction,
  };
}

export async function closeApprovedKnowledgeWithMaterialGaps(input: {
  projectRoot: string;
  expected_ledger_revision: string | null;
  ledger: unknown;
  approved_structure: Record<string, unknown>;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<IndexerMaterialGapWriteReceipt> {
  return withProjectWriteLock(input.projectRoot, CLOSE_TRANSACTION, () =>
    closeApprovedKnowledgeUnlocked(input)
  );
}

export async function readIndexerMaterialGapStructure(projectRoot: string): Promise<{
  state: StructureState;
  ledger: IndexerMaterialGapLedger;
  structure: Record<string, unknown>;
} | undefined> {
  const current = await readStructure(projectRoot);
  const ledger = currentLedger(current.record);
  if (current.record === undefined || ledger === undefined) return undefined;
  const state = current.record.structure_state ??
    (approvedProjectionPresent(current.record)
      ? "approved-projection-closed"
      : "retained-state-present");
  return { state, ledger, structure: current.record };
}
