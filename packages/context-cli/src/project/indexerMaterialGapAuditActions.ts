import {
  deriveIndexerMaterialAnswerFlowStatus,
} from "@c4a/context";
import { indexerOwnerDomainAuthorities } from "./indexerMaterialGapAuthority.js";
import { planProjectIndexerReconciliationGapCheckpoint } from
  "./indexerMaterialGapActions.js";
import { readIndexerMaterialGapStructure } from "./indexerMaterialGapStore.js";

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

export async function auditProjectIndexerMaterialGapState(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "audit-material-gap-state input");
  if (value.protocol !== "context.indexer.audit-material-gap-state-input/v1") {
    throw new TypeError("audit-material-gap-state input protocol is invalid");
  }
  const phase = value.phase;
  if (phase !== "before-main-review" && phase !== "after-main-review") {
    throw new TypeError("audit-material-gap-state phase is invalid");
  }
  const current = await readIndexerMaterialGapStructure(input.projectRoot);
  const planned = await planProjectIndexerReconciliationGapCheckpoint({
    projectRoot: input.projectRoot,
    reconciliationInput: value.reconciliation_input,
    ...(current === undefined ? {} : { currentLedger: current.ledger }),
  });
  const driftDetected = current?.ledger.revision !== planned.ledger.revision;
  const status = deriveIndexerMaterialAnswerFlowStatus({
    ledger: planned.ledger,
    current_layout_digest: text(value.current_layout_digest, "current layout digest"),
    owner_domain_authorities: indexerOwnerDomainAuthorities(planned.registry).map(
      (authority) => ({
        owner_cell_ref: authority.owner_cell_ref,
        domain_state: authority.domain_state,
      }),
    ),
  });
  const nextAction = phase === "before-main-review"
    ? driftDetected
      ? "checkpoint-material-gaps" as const
      : "none" as const
    : !status.main_candidate_review_allowed
    ? "continue-indexer-lifecycle" as const
    : current?.state === "approved-projection-closed" && !driftDetected
    ? "none" as const
    : "close-indexer-approved-knowledge" as const;
  const graphOutcome = nextAction === "checkpoint-material-gaps"
    ? "partial" as const
    : nextAction === "close-indexer-approved-knowledge"
    ? "unverified" as const
    : nextAction === "continue-indexer-lifecycle"
    ? "blocked" as const
    : "completed" as const;
  return {
    protocol: "context.indexer.material-gap-audit-result/v1" as const,
    phase,
    current_structure_state: current?.state ?? "missing",
    current_ledger_revision: current?.ledger.revision ?? null,
    expected_ledger_revision: planned.ledger.revision,
    drift_detected: driftDetected,
    next_action: nextAction,
    expected_ledger: planned.ledger,
    reconciliation: planned.report,
    status,
    graph_outcome: graphOutcome,
  };
}
