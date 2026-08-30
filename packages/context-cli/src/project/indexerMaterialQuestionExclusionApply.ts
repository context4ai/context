import {
  applyIndexerMaterialQuestionExclusion,
  validateIndexerMaterialQuestionExclusionConfirmation,
  validateIndexerMaterialQuestionExclusionReport,
  type IndexerMaterialGapLedger,
  type IndexerMaterialQuestionExclusionConfirmation,
  type IndexerMaterialQuestionExclusionReport,
} from "@c4a/context";
import type { DurableTransactionFailureInjector } from
  "./durableSingleFileTransaction.js";
import {
  checkpointIndexerMaterialGapStore,
  readIndexerMaterialGapStructure,
  recoverIndexerMaterialGapStore,
  type IndexerMaterialGapWriteReceipt,
} from "./indexerMaterialGapStore.js";

export interface IndexerMaterialQuestionExclusionApplyReceipt {
  protocol: "context.indexer.material-question-exclusion-apply-receipt/v1";
  report_digest: string;
  decision_digest: string;
  predecessor_ledger_revision: string;
  successor_ledger_revision: string;
  ledger: IndexerMaterialGapLedger;
  checkpoint: IndexerMaterialGapWriteReceipt;
}

export async function applyAndCheckpointIndexerMaterialQuestionExclusion(input: {
  projectRoot: string;
  expected_ledger_revision: string;
  report: IndexerMaterialQuestionExclusionReport;
  confirmation: IndexerMaterialQuestionExclusionConfirmation;
  resolved_question: unknown;
  domain_state: "required" | "optional" | "out-of-scope";
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<IndexerMaterialQuestionExclusionApplyReceipt> {
  await recoverIndexerMaterialGapStore(input.projectRoot);
  const current = await readIndexerMaterialGapStructure(input.projectRoot);
  if (current === undefined) {
    throw new TypeError("material question exclusion requires a retained ledger checkpoint");
  }
  if (current.ledger.revision !== input.expected_ledger_revision) {
    throw new TypeError("material question exclusion retained ledger CAS is stale");
  }
  const report = validateIndexerMaterialQuestionExclusionReport({
    ledger: current.ledger,
    report: input.report,
    resolved_question: input.resolved_question,
    domain_state: input.domain_state,
  });
  const confirmation = validateIndexerMaterialQuestionExclusionConfirmation({
    report,
    confirmation: input.confirmation,
  });
  const ledger = applyIndexerMaterialQuestionExclusion({
    ledger: current.ledger,
    expected_revision: input.expected_ledger_revision,
    report,
    confirmation,
    resolved_question: input.resolved_question,
    domain_state: input.domain_state,
  });
  const checkpoint = await checkpointIndexerMaterialGapStore({
    projectRoot: input.projectRoot,
    expected_ledger_revision: input.expected_ledger_revision,
    ledger,
    ...(input.inject_failure === undefined
      ? {}
      : { inject_failure: input.inject_failure }),
  });
  return {
    protocol: "context.indexer.material-question-exclusion-apply-receipt/v1",
    report_digest: report.report_digest,
    decision_digest: confirmation.decision_digest,
    predecessor_ledger_revision: input.expected_ledger_revision,
    successor_ledger_revision: ledger.revision,
    ledger,
    checkpoint,
  };
}
