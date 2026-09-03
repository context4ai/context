import { planProjectIndexerReconciliationGapCheckpoint } from
  "./indexerMaterialGapActions.js";
import { readIndexerMaterialGapState } from "./indexerMaterialGapStore.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
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
  const current = await readIndexerMaterialGapState(input.projectRoot);
  const planned = await planProjectIndexerReconciliationGapCheckpoint({
    projectRoot: input.projectRoot,
    reconciliationInput: value.reconciliation_input,
    ...(current === undefined ? {} : { currentLedger: current.ledger }),
  });
  const driftDetected = current?.ledger.revision !== planned.ledger.revision;
  const reviewAllowed = planned.report.can_report_complete;
  const nextAction = driftDetected
    ? "checkpoint-material-gaps" as const
    : !reviewAllowed
    ? "continue-indexer-lifecycle" as const
    : phase === "after-main-review"
    ? "close-indexer-approved-knowledge" as const
    : "none" as const;
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
    current_ledger_revision: current?.ledger.revision ?? null,
    expected_ledger_revision: planned.ledger.revision,
    drift_detected: driftDetected,
    blocking_count: planned.report.blocking_count,
    main_candidate_review_allowed: reviewAllowed,
    next_action: nextAction,
    expected_ledger: planned.ledger,
    reconciliation: planned.report,
    graph_outcome: graphOutcome,
  };
}
