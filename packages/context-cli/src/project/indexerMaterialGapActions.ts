import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  buildIndexerMaterialGapLedger,
  canonicalIndexerJson,
  checkpointIndexerEmittedMaterialGaps,
  deriveIndexerMaterialAnswerFlowStatus,
  indexerMaterialAnswerBindingDigestFromLedgerEntry,
  indexerMaterialAnswerReviewResolutionResultSchema,
  indexerMaterialGapQuestionKey,
  indexerProtocolDigest,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateIndexerMaterialGapLedger,
  type IndexerUnresolvedMaterialGap,
} from "@c4a/context";
import { indexerAuthoritativeOwnerCellRefs, indexerOwnerDomainAuthorities } from
  "./indexerMaterialGapAuthority.js";
import {
  checkpointIndexerMaterialGapStore,
  readIndexerMaterialGapStructure,
} from "./indexerMaterialGapStore.js";
import { reconcileProjectIndexerResults } from "./indexerResultReconciliationActions.js";

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

function expectedRevision(value: unknown): string | null {
  if (value === null) return null;
  return text(value, "expected material gap ledger revision");
}

async function currentRegistry(projectRoot: string) {
  return parseIndexerRegistry(await readFile(
    join(projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
}

function assertCurrentRevision(input: {
  expected: string | null;
  actual: string | null;
}): void {
  if (input.expected !== input.actual) {
    throw new TypeError("material gap lifecycle input targets a stale retained ledger");
  }
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
  const current = await readIndexerMaterialGapStructure(input.projectRoot);
  assertCurrentRevision({ expected, actual: current?.ledger.revision ?? null });
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
    stage: "reconciliation" as const,
    report: planned.report,
    ledger: planned.ledger,
    checkpoint,
    graph_outcome: planned.report.graph_outcome,
  };
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
    current_entries: report.material_gaps.map((gap): IndexerUnresolvedMaterialGap => {
      if (gap.entry.state !== "unresolved") {
        throw new TypeError("reconciliation material gap must emit an unresolved entry");
      }
      return gap.entry;
    }),
    complete_inventory_digest: report.question_target_inventory_digest,
  });
  return {
    report,
    registry,
    ledger,
  };
}

function withoutResultDigest<T extends { result_digest: string }>(value: T) {
  const { result_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

function assertAnswerApprovedTransition(input: {
  current: ReturnType<typeof validateIndexerMaterialGapLedger>;
  successor: ReturnType<typeof validateIndexerMaterialGapLedger>;
  binding_digest: string;
  consumed_workset_digest: string;
  review_decision_digest: string;
}): void {
  if (
    input.current.question_target_inventory_digest !==
      input.successor.question_target_inventory_digest ||
    input.current.entries.length !== input.successor.entries.length
  ) {
    throw new TypeError("answer-approved checkpoint changes material gap authority");
  }
  const currentByKey = new Map(input.current.entries.map((entry) => [
    indexerMaterialGapQuestionKey(entry),
    entry,
  ]));
  const changed = input.successor.entries.filter((entry) => {
    const previous = currentByKey.get(indexerMaterialGapQuestionKey(entry));
    return previous === undefined ||
      canonicalIndexerJson(previous) !== canonicalIndexerJson(entry);
  });
  if (changed.length !== 1 || changed[0]!.state !== "answer-approved") {
    throw new TypeError("answer-approved checkpoint must change exactly one question");
  }
  const next = changed[0]!;
  const previous = currentByKey.get(indexerMaterialGapQuestionKey(next));
  if (previous === undefined || previous.state !== "unresolved") {
    throw new TypeError("answer-approved checkpoint requires one unresolved predecessor");
  }
  const { state: _previousState, ...previousBase } = previous;
  const { state: _nextState, answer, ...nextBase } = next;
  void _previousState;
  void _nextState;
  if (
    canonicalIndexerJson(previousBase) !== canonicalIndexerJson(nextBase) ||
    answer.accepted_workset_digest !== input.consumed_workset_digest ||
    answer.review_decision_digest !== input.review_decision_digest ||
    indexerMaterialAnswerBindingDigestFromLedgerEntry(next) !== input.binding_digest
  ) {
    throw new TypeError("answer-approved checkpoint fact is not an exact Review transition");
  }
}

export async function checkpointProjectIndexerMaterialAnswerReview(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "checkpoint material-answer Review input");
  if (value.protocol !== "context.indexer.checkpoint-material-answer-review-input/v1") {
    throw new TypeError("checkpoint material-answer Review input protocol is invalid");
  }
  const resolution = indexerMaterialAnswerReviewResolutionResultSchema.parse(
    value.resolution_result,
  );
  if (
    indexerProtocolDigest(withoutResultDigest(resolution)) !== resolution.result_digest ||
    resolution.state !== "approved"
  ) {
    throw new TypeError("only an exact approved material-answer Review may be checkpointed");
  }
  const current = await readIndexerMaterialGapStructure(input.projectRoot);
  if (current === undefined) {
    throw new TypeError("answer-approved checkpoint requires retained material gaps");
  }
  const approval = resolution.answer_approval;
  if (current.ledger.revision !== approval.predecessor_ledger_revision) {
    throw new TypeError("answer-approved checkpoint predecessor is stale");
  }
  const successor = validateIndexerMaterialGapLedger(approval.successor_ledger);
  assertAnswerApprovedTransition({
    current: current.ledger,
    successor,
    binding_digest: approval.binding_digest,
    consumed_workset_digest: approval.consumed_workset_digest,
    review_decision_digest: resolution.review_decision.decision_digest,
  });
  const checkpoint = await checkpointIndexerMaterialGapStore({
    projectRoot: input.projectRoot,
    expected_ledger_revision: approval.predecessor_ledger_revision,
    ledger: successor,
  });
  return {
    protocol: "context.indexer.material-gap-checkpoint-result/v1" as const,
    stage: "answer-approved" as const,
    ledger: successor,
    checkpoint,
    graph_outcome: "completed" as const,
  };
}

export async function evaluateProjectIndexerMaterialGaps(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "evaluate-material-gaps input");
  if (value.protocol !== "context.indexer.evaluate-material-gaps-input/v1") {
    throw new TypeError("evaluate-material-gaps input protocol is invalid");
  }
  const stage = value.stage;
  if (stage !== "pre-layout" && stage !== "post-actualization") {
    throw new TypeError("evaluate-material-gaps stage is invalid");
  }
  const current = await readIndexerMaterialGapStructure(input.projectRoot);
  if (current === undefined) throw new TypeError("material gap evaluation requires a checkpoint");
  const expected = text(value.expected_ledger_revision, "material gap evaluation revision");
  if (current.ledger.revision !== expected) {
    throw new TypeError("material gap evaluation targets a stale checkpoint");
  }
  const registry = await currentRegistry(input.projectRoot);
  const status = deriveIndexerMaterialAnswerFlowStatus({
    ledger: current.ledger,
    current_layout_digest: text(value.current_layout_digest, "current layout digest"),
    owner_domain_authorities: indexerOwnerDomainAuthorities(registry).map((authority) => ({
      owner_cell_ref: authority.owner_cell_ref,
      domain_state: authority.domain_state,
    })),
  });
  const graphOutcome = stage === "pre-layout"
    ? status.blocking_unresolved_question_keys.length > 0
      ? "blocked" as const
      : status.main_candidate_review_allowed
      ? "completed" as const
      : "partial" as const
    : status.main_candidate_review_allowed
    ? "completed" as const
    : "blocked" as const;
  return {
    protocol: "context.indexer.material-gap-evaluation-result/v1" as const,
    stage,
    status,
    graph_outcome: graphOutcome,
  };
}
