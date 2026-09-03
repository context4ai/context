import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  parseIndexerRegistry,
} from "@c4a/context";
import { approvedKnowledgeInputHash } from "./close.js";
import {
  durableContentDigest,
  runDurableSingleFileTransaction,
} from "./durableSingleFileTransaction.js";
import { indexerOwnerDomainAuthorities } from "./indexerMaterialGapAuthority.js";
import { readIndexerMaterialGapState } from "./indexerMaterialGapStore.js";
import { clearCompletedLifecycle } from "./lifecycleCleanup.js";
import { withProjectWriteLock } from "./writeLock.js";

const APPROVED_STRUCTURE_PATH = join("knowledge", "structure.yaml");
const APPROVED_STRUCTURE_SCHEMA = "context.approved-structure.v1";
const CLOSE_TRANSACTION = "close-approved-knowledge";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

async function readCurrentStructure(projectRoot: string): Promise<string | undefined> {
  const path = join(projectRoot, APPROVED_STRUCTURE_PATH);
  return existsSync(path) ? readFile(path, "utf8") : undefined;
}

export async function closeProjectIndexerApprovedKnowledge(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "close-indexer-approved-knowledge input");
  if (value.protocol !== "context.indexer.close-approved-knowledge-input/v1") {
    throw new TypeError("close-indexer-approved-knowledge input protocol is invalid");
  }
  const expectedRevision = text(
    value.expected_ledger_revision,
    "Indexer close expected_ledger_revision",
  );
  const current = await readIndexerMaterialGapState(input.projectRoot);
  if (current === undefined || current.ledger.revision !== expectedRevision) {
    throw new TypeError("Indexer close material gap runtime CAS is stale");
  }
  const registry = parseIndexerRegistry(await readFile(
    join(input.projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  const authorityByOwner = new Map(
    indexerOwnerDomainAuthorities(registry).map((authority) => [
      authority.owner_cell_ref,
      authority.domain_state,
    ]),
  );
  const blockingQuestionKeys = current.ledger.entries.filter((entry) =>
    authorityByOwner.get(entry.owner_cell_ref) !== "optional"
  );
  if (blockingQuestionKeys.length > 0) {
    throw new TypeError("Indexer close is blocked by unresolved required material gaps");
  }
  const approvedStructure = record(value.approved_structure, "approved Indexer structure");
  const approvedInputHash = text(
    approvedStructure.input_hash,
    "approved Indexer structure input_hash",
  );
  if (
    approvedStructure.schema_version !== APPROVED_STRUCTURE_SCHEMA ||
    !Array.isArray(approvedStructure.nodes) ||
    !Array.isArray(approvedStructure.views) ||
    !Array.isArray(approvedStructure.edges) ||
    approvedStructure.material_gap_ledger !== undefined ||
    approvedStructure.material_answers !== undefined ||
    approvedStructure.structure_state !== undefined
  ) {
    throw new TypeError("close requires a complete approved structure without runtime state");
  }
  if (await approvedKnowledgeInputHash(input.projectRoot) !== approvedInputHash) {
    throw new TypeError("close approved structure input_hash is stale");
  }
  const targetContent = YAML.stringify(approvedStructure);
  const currentContent = await readCurrentStructure(input.projectRoot);
  const transaction = await withProjectWriteLock(
    input.projectRoot,
    CLOSE_TRANSACTION,
    () => runDurableSingleFileTransaction({
      projectRoot: input.projectRoot,
      kind: CLOSE_TRANSACTION,
      target_path: APPROVED_STRUCTURE_PATH,
      expected_base_digest: currentContent === undefined
        ? null
        : durableContentDigest(currentContent),
      target_content: targetContent,
    }),
  );
  await clearCompletedLifecycle(input.projectRoot);
  return {
    protocol: "context.indexer.close-approved-knowledge-result/v1" as const,
    structure_path: APPROVED_STRUCTURE_PATH,
    structure_digest: transaction.target_digest,
    transaction,
    graph_outcome: "completed" as const,
  };
}
