import { z } from "zod";
import {
  indexerMaterialAnswerBindingDigestFromLedgerEntry,
  indexerMaterialGapQuestionKey,
  validateIndexerMaterialGapLedger,
} from "./indexerMaterialGapLedger.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const ownerDomainAuthoritySchema = z.object({
  owner_cell_ref: z.string().min(1),
  domain_state: z.enum(["required", "optional", "out-of-scope"]),
}).strict();

const flowStatusPayloadSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-flow-status/v1"),
  ledger_revision: indexerDigestSchema,
  current_layout_digest: indexerDigestSchema,
  blocking_unresolved_question_keys: z.array(z.string().min(1)),
  blocking_answer_approved_question_keys: z.array(z.string().min(1)),
  blocking_stale_actualization_question_keys: z.array(z.string().min(1)),
  recommended_pending_question_keys: z.array(z.string().min(1)),
  current_resolved_binding_digests: z.array(indexerDigestSchema),
  effective_blocking_gap_count: z.number().int().nonnegative(),
  layout_allowed: z.boolean(),
  conditional_layout_gate_allowed: z.boolean(),
  main_candidate_review_allowed: z.boolean(),
}).strict();

export const indexerMaterialAnswerFlowStatusSchema = flowStatusPayloadSchema.extend({
  status_digest: indexerDigestSchema,
}).strict();

export type IndexerMaterialAnswerFlowStatus = z.infer<
  typeof indexerMaterialAnswerFlowStatusSchema
>;

function sortedUnique(values: readonly string[], name: string): string[] {
  const result = [...values].sort(compareIndexerCanonicalText);
  if (new Set(result).size !== result.length) {
    throw new TypeError(`${name} must be unique`);
  }
  return result;
}

export function validateIndexerMaterialAnswerFlowStatus(
  value: unknown,
): IndexerMaterialAnswerFlowStatus {
  const status = indexerMaterialAnswerFlowStatusSchema.parse(value);
  const { status_digest: _digest, ...payload } = status;
  void _digest;
  if (indexerProtocolDigest(payload) !== status.status_digest) {
    throw new TypeError("material-answer flow status digest is invalid");
  }
  const keyFields = [
    status.blocking_unresolved_question_keys,
    status.blocking_answer_approved_question_keys,
    status.blocking_stale_actualization_question_keys,
    status.recommended_pending_question_keys,
    status.current_resolved_binding_digests,
  ];
  if (keyFields.some((items) =>
    new Set(items).size !== items.length ||
    canonicalIndexerJson(items) !== canonicalIndexerJson([...items].sort())
  )) {
    throw new TypeError("material-answer flow status lists are not canonical");
  }
  const effectiveCount =
    status.blocking_unresolved_question_keys.length +
    status.blocking_answer_approved_question_keys.length +
    status.blocking_stale_actualization_question_keys.length;
  if (
    status.effective_blocking_gap_count !== effectiveCount ||
    status.layout_allowed !==
      (status.blocking_unresolved_question_keys.length === 0) ||
    status.main_candidate_review_allowed !== (effectiveCount === 0) ||
    status.conditional_layout_gate_allowed !==
      status.main_candidate_review_allowed
  ) {
    throw new TypeError("material-answer flow status admission flags are inconsistent");
  }
  return status;
}

export function deriveIndexerMaterialAnswerFlowStatus(input: {
  ledger: unknown;
  current_layout_digest: string;
  owner_domain_authorities: readonly z.infer<typeof ownerDomainAuthoritySchema>[];
}): IndexerMaterialAnswerFlowStatus {
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  const layoutDigest = indexerDigestSchema.parse(input.current_layout_digest);
  const authorities = input.owner_domain_authorities.map((authority) =>
    ownerDomainAuthoritySchema.parse(authority)
  );
  const authorityByOwner = new Map(
    authorities.map((authority) => [authority.owner_cell_ref, authority.domain_state]),
  );
  if (authorityByOwner.size !== authorities.length) {
    throw new TypeError("material-answer owner domain authorities must be unique");
  }
  const blockingUnresolved: string[] = [];
  const blockingApproved: string[] = [];
  const blockingStale: string[] = [];
  const recommendedPending: string[] = [];
  const resolvedBindings: string[] = [];
  for (const entry of ledger.entries) {
    const domainState = authorityByOwner.get(entry.owner_cell_ref);
    if (domainState === undefined || domainState === "out-of-scope") {
      blockingUnresolved.push(indexerMaterialGapQuestionKey(entry));
      continue;
    }
    const questionKey = indexerMaterialGapQuestionKey(entry);
    const pending = entry.state === "unresolved" || entry.state === "answer-approved" ||
      (entry.state === "resolved" && entry.actualization.layout_digest !== layoutDigest);
    if (domainState === "optional") {
      if (pending) recommendedPending.push(questionKey);
      if (entry.state === "resolved" && !pending) {
        resolvedBindings.push(indexerMaterialAnswerBindingDigestFromLedgerEntry(entry));
      }
      continue;
    }
    if (entry.state === "unresolved") blockingUnresolved.push(questionKey);
    if (entry.state === "answer-approved") blockingApproved.push(questionKey);
    if (entry.state === "resolved") {
      if (entry.actualization.layout_digest === layoutDigest) {
        resolvedBindings.push(indexerMaterialAnswerBindingDigestFromLedgerEntry(entry));
      } else {
        blockingStale.push(questionKey);
      }
    }
  }
  const effectiveCount =
    blockingUnresolved.length + blockingApproved.length + blockingStale.length;
  const payload = flowStatusPayloadSchema.parse({
    protocol: "context.indexer.material-answer-flow-status/v1",
    ledger_revision: ledger.revision,
    current_layout_digest: layoutDigest,
    blocking_unresolved_question_keys: sortedUnique(
      blockingUnresolved,
      "blocking unresolved question keys",
    ),
    blocking_answer_approved_question_keys: sortedUnique(
      blockingApproved,
      "blocking answer-approved question keys",
    ),
    blocking_stale_actualization_question_keys: sortedUnique(
      blockingStale,
      "blocking stale actualization question keys",
    ),
    recommended_pending_question_keys: sortedUnique(
      recommendedPending,
      "recommended pending question keys",
    ),
    current_resolved_binding_digests: sortedUnique(
      resolvedBindings,
      "current resolved binding digests",
    ),
    effective_blocking_gap_count: effectiveCount,
    layout_allowed: blockingUnresolved.length === 0,
    conditional_layout_gate_allowed: effectiveCount === 0,
    main_candidate_review_allowed: effectiveCount === 0,
  });
  return validateIndexerMaterialAnswerFlowStatus({
    ...payload,
    status_digest: indexerProtocolDigest(payload),
  });
}
