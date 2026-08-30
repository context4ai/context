import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  closeIndexerResolvedMaterialAnswers,
  deriveIndexerMaterialAnswerFlowStatus,
  parseIndexerRegistry,
  type IndexerApprovedMaterialAnswerProjection,
} from "@c4a/context";
import { indexerOwnerDomainAuthorities } from "./indexerMaterialGapAuthority.js";
import {
  closeApprovedKnowledgeWithMaterialGaps,
  readIndexerMaterialGapStructure,
} from "./indexerMaterialGapStore.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export async function closeProjectIndexerApprovedKnowledge(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "close-indexer-approved-knowledge input");
  if (value.protocol !== "context.indexer.close-approved-knowledge-input/v1") {
    throw new TypeError("close-indexer-approved-knowledge input protocol is invalid");
  }
  const current = await readIndexerMaterialGapStructure(input.projectRoot);
  if (current === undefined) {
    throw new TypeError("Indexer close requires a retained material gap checkpoint");
  }
  const expectedRevision = text(
    value.expected_ledger_revision,
    "Indexer close expected_ledger_revision",
  );
  if (current.ledger.revision !== expectedRevision) {
    throw new TypeError("Indexer close material gap ledger CAS is stale");
  }
  const approvedStructure = record(value.approved_structure, "approved Indexer structure");
  const registry = parseIndexerRegistry(await readFile(
    join(input.projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  const status = deriveIndexerMaterialAnswerFlowStatus({
    ledger: current.ledger,
    current_layout_digest: text(
      approvedStructure.layout_digest,
      "approved Indexer structure layout_digest",
    ),
    owner_domain_authorities: indexerOwnerDomainAuthorities(registry).map((authority) => ({
      owner_cell_ref: authority.owner_cell_ref,
      domain_state: authority.domain_state,
    })),
  });
  if (!status.main_candidate_review_allowed) {
    throw new TypeError("Indexer close is blocked by current required material gaps");
  }
  const ledger = closeIndexerResolvedMaterialAnswers({
    ledger: current.ledger,
    expected_revision: expectedRevision,
    approved_structure_bindings: list(
      approvedStructure.material_answers,
      "approved structure material_answers",
    ) as IndexerApprovedMaterialAnswerProjection[],
  });
  const checkpoint = await closeApprovedKnowledgeWithMaterialGaps({
    projectRoot: input.projectRoot,
    expected_ledger_revision: expectedRevision,
    ledger,
    approved_structure: approvedStructure,
  });
  return {
    protocol: "context.indexer.close-approved-knowledge-result/v1" as const,
    ledger,
    checkpoint,
    preclose_status: status,
    graph_outcome: "completed" as const,
  };
}
