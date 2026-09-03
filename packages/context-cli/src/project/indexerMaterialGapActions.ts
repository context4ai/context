import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  buildIndexerMaterialGapLedger,
  checkpointIndexerEmittedMaterialGaps,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateIndexerMaterialGapLedger,
  type IndexerUnresolvedMaterialGap,
} from "@c4a/context";
import { indexerAuthoritativeOwnerCellRefs } from
  "./indexerMaterialGapAuthority.js";
import {
  checkpointIndexerMaterialGapStore,
  readIndexerMaterialGapState,
} from "./indexerMaterialGapStore.js";
import { reconcileProjectIndexerResults } from "./indexerResultReconciliationActions.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectedRevision(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("expected material gap ledger revision must be a digest or null");
  }
  return value;
}

async function currentRegistry(projectRoot: string) {
  return parseIndexerRegistry(await readFile(
    join(projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
}

export async function planProjectIndexerReconciliationGapCheckpoint(input: {
  projectRoot: string;
  reconciliationInput: unknown;
  currentLedger?: ReturnType<typeof validateIndexerMaterialGapLedger>;
}) {
  const report = await reconcileProjectIndexerResults({
    projectRoot: input.projectRoot,
    value: input.reconciliationInput,
  });
  const registry = await currentRegistry(input.projectRoot);
  const digests = indexerRegistryDigests(registry);
  if (
    report.registry_digest !== digests.registryDigest ||
    report.requirement_set_digest !== digests.requirementSetDigest
  ) {
    throw new TypeError("material gap checkpoint reconciliation authority is stale");
  }
  const base = input.currentLedger ?? buildIndexerMaterialGapLedger({
    question_target_inventory_digest: report.question_target_inventory_digest,
    entries: [],
  });
  const ledger = checkpointIndexerEmittedMaterialGaps({
    ledger: base,
    expected_revision: base.revision,
    authoritative_owner_cell_refs: indexerAuthoritativeOwnerCellRefs(registry),
    current_entries: report.material_gaps.map((gap): IndexerUnresolvedMaterialGap =>
      gap.entry
    ),
    complete_inventory_digest: report.question_target_inventory_digest,
  });
  return { report, registry, ledger };
}

export async function checkpointProjectIndexerReconciliationGaps(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "checkpoint-material-gaps input");
  if (value.protocol !== "context.indexer.checkpoint-material-gaps-input/v1") {
    throw new TypeError("checkpoint-material-gaps input protocol is invalid");
  }
  const expected = expectedRevision(value.expected_ledger_revision);
  const current = await readIndexerMaterialGapState(input.projectRoot);
  if ((current?.ledger.revision ?? null) !== expected) {
    throw new TypeError("material gap lifecycle input targets stale runtime state");
  }
  const planned = await planProjectIndexerReconciliationGapCheckpoint({
    projectRoot: input.projectRoot,
    reconciliationInput: value.reconciliation_input,
    ...(current === undefined ? {} : { currentLedger: current.ledger }),
  });
  const checkpoint = await checkpointIndexerMaterialGapStore({
    projectRoot: input.projectRoot,
    expected_ledger_revision: expected,
    ledger: planned.ledger,
  });
  return {
    protocol: "context.indexer.material-gap-checkpoint-result/v1" as const,
    report: planned.report,
    ledger: planned.ledger,
    checkpoint,
    graph_outcome: planned.report.graph_outcome,
  };
}
