import { z } from "zod";
import {
  indexerComposedResultEnvelopeSchema,
  indexerComposerInvocationReceiptSchema,
  indexerEffectiveComposerSetSchema,
  indexerLayerFragmentRunResultSchema,
  indexerPostAuthorWorksetDigest,
  indexerPostAuthorWorksetSchema,
  indexerPostAuthorWorksetSetDigest,
  indexerPostAuthorWorksetSetSchema,
  buildIndexerPostAuthorFragmentRequest,
  composeIndexerPostAuthorEnvelope,
  validateIndexerEffectiveComposerSet,
  validateIndexerPostAuthorFragmentResult,
  validateIndexerPrimaryResultView,
  type IndexerComposedResultEnvelope,
  type IndexerPostAuthorPlan,
} from "./indexerPostAuthorComposition.js";
import { indexerMaterializedLayerFragmentSchema } from "./indexerLayerComposition.js";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const composerRefSchema = z.string().regex(
  /^provider:[^#]+#layer:[^#]+#composer:[A-Za-z0-9._-]+$/u,
);

const ledgerEntryBase = {
  composer_ref: composerRefSchema,
  workset_digest: indexerDigestSchema,
};

const pendingEntrySchema = z.object({
  ...ledgerEntryBase,
  state: z.literal("pending"),
}).strict();

const runningEntrySchema = z.object({
  ...ledgerEntryBase,
  state: z.literal("running"),
  request_digest: indexerDigestSchema,
}).strict();

const acceptedEntrySchema = z.object({
  ...ledgerEntryBase,
  state: z.literal("accepted"),
  request_digest: indexerDigestSchema,
  result: indexerLayerFragmentRunResultSchema,
  receipt: indexerComposerInvocationReceiptSchema,
  fragments: z.array(indexerMaterializedLayerFragmentSchema),
}).strict();

const failedEntrySchema = z.object({
  ...ledgerEntryBase,
  state: z.literal("failed"),
  request_digest: indexerDigestSchema,
  reason_code: z.string().min(1),
  dependency_digests: z.array(indexerDigestSchema),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.dependency_digests, context, "dependency_digests");
});

const staleEntrySchema = z.object({
  ...ledgerEntryBase,
  state: z.literal("stale"),
  previous_workset_digest: indexerDigestSchema,
  invalidated_by: z.enum(["workset-changed", "accepted-record-invalid"]),
}).strict();

export const indexerPostAuthorRunLedgerEntrySchema = z.union([
  pendingEntrySchema,
  runningEntrySchema,
  acceptedEntrySchema,
  failedEntrySchema,
  staleEntrySchema,
]);

export type IndexerPostAuthorRunLedgerEntry = z.infer<
  typeof indexerPostAuthorRunLedgerEntrySchema
>;

export const indexerPostAuthorRunLedgerSchema = z.object({
  protocol: z.literal("context.indexer.post-author-run-ledger/v1"),
  workset_set_digest: indexerDigestSchema,
  entries: z.array(indexerPostAuthorRunLedgerEntrySchema),
  ledger_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.entries.map((entry) => entry.composer_ref), context, "entries");
});

export type IndexerPostAuthorRunLedger = z.infer<
  typeof indexerPostAuthorRunLedgerSchema
>;

type LedgerPayload = Omit<IndexerPostAuthorRunLedger, "ledger_digest">;

function ledgerPayload(value: LedgerPayload): LedgerPayload {
  return {
    protocol: value.protocol,
    workset_set_digest: value.workset_set_digest,
    entries: value.entries,
  };
}

export function indexerPostAuthorRunLedgerDigest(value: LedgerPayload): string {
  return indexerProtocolDigest(ledgerPayload(value));
}

function canonicalEntries(
  entries: readonly IndexerPostAuthorRunLedgerEntry[],
): IndexerPostAuthorRunLedgerEntry[] {
  const parsed = entries.map((entry) =>
    indexerPostAuthorRunLedgerEntrySchema.parse(entry)
  ).sort((left, right) =>
    compareIndexerCanonicalText(left.composer_ref, right.composer_ref)
  );
  if (new Set(parsed.map((entry) => entry.composer_ref)).size !== parsed.length) {
    throw new TypeError("post-author ledger must contain one entry per composer");
  }
  for (const entry of parsed) {
    if (entry.state === "failed") {
      const sorted = [...entry.dependency_digests].sort(compareIndexerCanonicalText);
      if (sorted.some((digest, index) => digest !== entry.dependency_digests[index])) {
        throw new TypeError("post-author failure dependencies must use canonical ordering");
      }
    }
  }
  return parsed;
}

function buildLedger(input: {
  workset_set_digest: string;
  entries: readonly IndexerPostAuthorRunLedgerEntry[];
}): IndexerPostAuthorRunLedger {
  const payload: LedgerPayload = {
    protocol: "context.indexer.post-author-run-ledger/v1",
    workset_set_digest: input.workset_set_digest,
    entries: canonicalEntries(input.entries),
  };
  return indexerPostAuthorRunLedgerSchema.parse({
    ...payload,
    ledger_digest: indexerPostAuthorRunLedgerDigest(payload),
  });
}

export function validateIndexerPostAuthorRunLedger(
  value: unknown,
): IndexerPostAuthorRunLedger {
  const ledger = indexerPostAuthorRunLedgerSchema.parse(value);
  if (indexerPostAuthorRunLedgerDigest(ledger) !== ledger.ledger_digest) {
    throw new TypeError("post-author run ledger digest is invalid");
  }
  const entries = canonicalEntries(ledger.entries);
  if (entries.some((entry, index) => entry.composer_ref !== ledger.entries[index]?.composer_ref)) {
    throw new TypeError("post-author run ledger entries must use canonical ordering");
  }
  return ledger;
}

function requirePendingPlan(
  plan: IndexerPostAuthorPlan,
): Extract<IndexerPostAuthorPlan, { state: "pending" }> {
  validatePostAuthorPlan(plan);
  if (plan.state !== "pending") {
    throw new TypeError("zero composer selection has no post-author run ledger work");
  }
  return plan;
}

function validatePostAuthorPlan(plan: IndexerPostAuthorPlan): void {
  const set = indexerPostAuthorWorksetSetSchema.parse(plan.workset_set);
  if (
    indexerPostAuthorWorksetSetDigest({
      protocol: set.protocol,
      author_workset_digest: set.author_workset_digest,
      primary_result_digest: set.primary_result_digest,
      effective_composer_set_digest: set.effective_composer_set_digest,
      ...(set.primary_result_view_digest === undefined
        ? {}
        : { primary_result_view_digest: set.primary_result_view_digest }),
      items: set.items,
    }) !== set.workset_set_digest
  ) {
    throw new TypeError("post-author workset set digest is invalid");
  }
  const itemRefs = set.items.map((item) => item.composer_ref);
  if (
    new Set(itemRefs).size !== itemRefs.length ||
    itemRefs.some((ref, index) => [...itemRefs].sort()[index] !== ref)
  ) {
    throw new TypeError("post-author workset set items must be unique and canonical");
  }
  if (plan.state === "not-required") {
    if (
      plan.primary_result_view !== null ||
      plan.worksets.length !== 0 ||
      set.items.length !== 0 ||
      set.primary_result_view_digest !== undefined
    ) {
      throw new TypeError("not-required post-author plan must be empty");
    }
    return;
  }
  const view = validateIndexerPrimaryResultView(plan.primary_result_view);
  if (
    set.primary_result_view_digest !== view.view_digest ||
    set.primary_result_digest !== view.primary_result_digest ||
    set.author_workset_digest !== view.workset_digest
  ) {
    throw new TypeError("post-author set does not bind its PrimaryResultView");
  }
  const worksets = plan.worksets.map((candidate) => {
    const workset = indexerPostAuthorWorksetSchema.parse(candidate);
    const payload = Object.fromEntries(
      Object.entries(workset).filter(([key]) => key !== "workset_digest"),
    ) as Omit<typeof workset, "workset_digest">;
    if (indexerPostAuthorWorksetDigest(payload) !== workset.workset_digest) {
      throw new TypeError("post-author workset digest is invalid");
    }
    const expectedFingerprint = indexerProtocolDigest({
      composer_ref: workset.composer_ref,
      composer_selection_entry_digest: workset.composer_selection_entry_digest,
      ...(workset.composer_contract_digest === undefined
        ? {}
        : { composer_contract_digest: workset.composer_contract_digest }),
      current_profile_binding_digest: workset.current_profile_binding_digest,
      primary_result_view_digest: workset.primary_result_view_digest,
    });
    if (
      workset.composer_execution_fingerprint !== expectedFingerprint ||
      workset.primary_result_view_digest !== view.view_digest ||
      workset.primary_result_digest !== view.primary_result_digest ||
      workset.author_workset_digest !== view.workset_digest ||
      !workset.composer_ref.startsWith(`${workset.target_layer_ref}#composer:`)
    ) {
      throw new TypeError("post-author workset authority or execution fingerprint is invalid");
    }
    const targets = [...workset.allowed_target_refs].sort(compareIndexerCanonicalText);
    if (
      new Set(targets).size !== targets.length ||
      targets.some((target, index) => target !== workset.allowed_target_refs[index])
    ) {
      throw new TypeError("post-author workset targets must be unique and canonical");
    }
    return workset;
  });
  const expectedItems = worksets.map((workset) => ({
    workset_digest: workset.workset_digest,
    composer_ref: workset.composer_ref,
    composer_selection_entry_digest: workset.composer_selection_entry_digest,
  }));
  if (indexerProtocolDigest(expectedItems) !== indexerProtocolDigest(set.items)) {
    throw new TypeError("post-author workset set items do not match the worksets");
  }
}

function worksetFor(
  plan: Extract<IndexerPostAuthorPlan, { state: "pending" }>,
  composerRef: string,
) {
  const workset = plan.worksets.find((item) => item.composer_ref === composerRef);
  if (workset === undefined) {
    throw new TypeError(`post-author composer is not enabled: ${composerRef}`);
  }
  return indexerPostAuthorWorksetSchema.parse(workset);
}

function acceptedEntryIsCurrent(input: {
  entry: z.infer<typeof acceptedEntrySchema>;
  plan: Extract<IndexerPostAuthorPlan, { state: "pending" }>;
  validator_contract_digest: string;
}): boolean {
  try {
    const workset = worksetFor(input.plan, input.entry.composer_ref);
    const request = buildIndexerPostAuthorFragmentRequest({
      workset,
      primary_result_view: input.plan.primary_result_view,
    });
    if (
      input.entry.workset_digest !== workset.workset_digest ||
      input.entry.request_digest !== request.request_digest
    ) return false;
    const validated = validateIndexerPostAuthorFragmentResult({
      request,
      result: input.entry.result,
      validator_contract_digest: input.validator_contract_digest,
    });
    return (
      indexerProtocolDigest(validated.receipt) ===
        indexerProtocolDigest(input.entry.receipt) &&
      indexerProtocolDigest(validated.fragments) ===
        indexerProtocolDigest(input.entry.fragments)
    );
  } catch {
    return false;
  }
}

export function initializeIndexerPostAuthorRunLedger(
  plan: IndexerPostAuthorPlan,
): IndexerPostAuthorRunLedger {
  validatePostAuthorPlan(plan);
  return buildLedger({
    workset_set_digest: plan.workset_set.workset_set_digest,
    entries: plan.worksets.map((workset) => ({
      composer_ref: workset.composer_ref,
      workset_digest: workset.workset_digest,
      state: "pending" as const,
    })),
  });
}

export function recoverIndexerPostAuthorRunLedger(input: {
  plan: IndexerPostAuthorPlan;
  previous_ledger?: unknown;
  validator_contract_digest: string;
}): IndexerPostAuthorRunLedger {
  if (input.plan.state === "not-required") {
    return initializeIndexerPostAuthorRunLedger(input.plan);
  }
  const plan = requirePendingPlan(input.plan);
  if (input.previous_ledger === undefined) {
    return initializeIndexerPostAuthorRunLedger(plan);
  }
  const previous = validateIndexerPostAuthorRunLedger(input.previous_ledger);
  const previousByComposer = new Map(
    previous.entries.map((entry) => [entry.composer_ref, entry]),
  );
  const entries = plan.worksets.map((workset): IndexerPostAuthorRunLedgerEntry => {
    const old = previousByComposer.get(workset.composer_ref);
    if (old === undefined) {
      return {
        composer_ref: workset.composer_ref,
        workset_digest: workset.workset_digest,
        state: "pending",
      };
    }
    if (old.workset_digest !== workset.workset_digest) {
      return {
        composer_ref: workset.composer_ref,
        workset_digest: workset.workset_digest,
        state: "stale",
        previous_workset_digest: old.workset_digest,
        invalidated_by: "workset-changed",
      };
    }
    if (old.state === "running") {
      return {
        composer_ref: workset.composer_ref,
        workset_digest: workset.workset_digest,
        state: "pending",
      };
    }
    if (
      old.state === "accepted" &&
      !acceptedEntryIsCurrent({
        entry: old,
        plan,
        validator_contract_digest: input.validator_contract_digest,
      })
    ) {
      return {
        composer_ref: workset.composer_ref,
        workset_digest: workset.workset_digest,
        state: "stale",
        previous_workset_digest: old.workset_digest,
        invalidated_by: "accepted-record-invalid",
      };
    }
    return old;
  });
  return buildLedger({
    workset_set_digest: plan.workset_set.workset_set_digest,
    entries,
  });
}

function replaceEntry(input: {
  ledger: IndexerPostAuthorRunLedger;
  composer_ref: string;
  replacement: IndexerPostAuthorRunLedgerEntry;
}): IndexerPostAuthorRunLedger {
  const found = input.ledger.entries.some(
    (entry) => entry.composer_ref === input.composer_ref,
  );
  if (!found) throw new TypeError(`post-author ledger has no ${input.composer_ref}`);
  return buildLedger({
    workset_set_digest: input.ledger.workset_set_digest,
    entries: input.ledger.entries.map((entry) =>
      entry.composer_ref === input.composer_ref ? input.replacement : entry
    ),
  });
}

export function startIndexerPostAuthorRun(input: {
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
  composer_ref: string;
}): {
  ledger: IndexerPostAuthorRunLedger;
  request: ReturnType<typeof buildIndexerPostAuthorFragmentRequest>;
} {
  const plan = requirePendingPlan(input.plan);
  const ledger = validateIndexerPostAuthorRunLedger(input.ledger);
  if (ledger.workset_set_digest !== plan.workset_set.workset_set_digest) {
    throw new TypeError("post-author ledger must be recovered against the current workset set");
  }
  const workset = worksetFor(plan, input.composer_ref);
  const current = ledger.entries.find((entry) => entry.composer_ref === input.composer_ref);
  if (current?.state !== "pending" && current?.state !== "stale") {
    throw new TypeError("only pending or stale post-author work may start");
  }
  const request = buildIndexerPostAuthorFragmentRequest({
    workset,
    primary_result_view: plan.primary_result_view,
  });
  return {
    request,
    ledger: replaceEntry({
      ledger,
      composer_ref: input.composer_ref,
      replacement: {
        composer_ref: input.composer_ref,
        workset_digest: workset.workset_digest,
        state: "running",
        request_digest: request.request_digest,
      },
    }),
  };
}

export function acceptIndexerPostAuthorRun(input: {
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
  composer_ref: string;
  result: unknown;
  validator_contract_digest: string;
}): IndexerPostAuthorRunLedger {
  const plan = requirePendingPlan(input.plan);
  const ledger = validateIndexerPostAuthorRunLedger(input.ledger);
  const current = ledger.entries.find((entry) => entry.composer_ref === input.composer_ref);
  if (current?.state !== "running") {
    throw new TypeError("post-author result requires a running ledger entry");
  }
  const workset = worksetFor(plan, input.composer_ref);
  const request = buildIndexerPostAuthorFragmentRequest({
    workset,
    primary_result_view: plan.primary_result_view,
  });
  if (current.request_digest !== request.request_digest) {
    throw new TypeError("post-author running request is stale");
  }
  const validated = validateIndexerPostAuthorFragmentResult({
    request,
    result: input.result,
    validator_contract_digest: input.validator_contract_digest,
  });
  return replaceEntry({
    ledger,
    composer_ref: input.composer_ref,
    replacement: {
      composer_ref: input.composer_ref,
      workset_digest: workset.workset_digest,
      state: "accepted",
      request_digest: request.request_digest,
      result: validated.result,
      receipt: validated.receipt,
      fragments: validated.fragments,
    },
  });
}

export function failIndexerPostAuthorRun(input: {
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
  composer_ref: string;
  reason_code: string;
  dependency_digests: readonly string[];
}): IndexerPostAuthorRunLedger {
  const plan = requirePendingPlan(input.plan);
  const ledger = validateIndexerPostAuthorRunLedger(input.ledger);
  const current = ledger.entries.find((entry) => entry.composer_ref === input.composer_ref);
  if (current?.state !== "running") {
    throw new TypeError("post-author failure requires a running ledger entry");
  }
  const workset = worksetFor(plan, input.composer_ref);
  return replaceEntry({
    ledger,
    composer_ref: input.composer_ref,
    replacement: {
      composer_ref: input.composer_ref,
      workset_digest: workset.workset_digest,
      state: "failed",
      request_digest: current.request_digest,
      reason_code: input.reason_code,
      dependency_digests: [...input.dependency_digests].sort(
        compareIndexerCanonicalText,
      ),
    },
  });
}

export function retryFailedIndexerPostAuthorRuns(input: {
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
}): IndexerPostAuthorRunLedger {
  const plan = requirePendingPlan(input.plan);
  const ledger = validateIndexerPostAuthorRunLedger(input.ledger);
  return buildLedger({
    workset_set_digest: ledger.workset_set_digest,
    entries: ledger.entries.map((entry) => {
      if (entry.state !== "failed") return entry;
      const workset = worksetFor(plan, entry.composer_ref);
      return {
        composer_ref: entry.composer_ref,
        workset_digest: workset.workset_digest,
        state: "pending" as const,
      };
    }),
  });
}

const nextRefSchema = z.object({
  composer_ref: composerRefSchema,
  workset_digest: indexerDigestSchema,
  state: z.enum(["pending", "failed", "stale"]),
}).strict();

export const indexerPostAuthorStatusSchema = z.object({
  protocol: z.literal("context.indexer.post-author-status/v1"),
  workset_set_digest: indexerDigestSchema,
  total_count: z.number().int().nonnegative(),
  pending_count: z.number().int().nonnegative(),
  accepted_count: z.number().int().nonnegative(),
  failed_count: z.number().int().nonnegative(),
  stale_count: z.number().int().nonnegative(),
  next_refs: z.array(nextRefSchema),
  accepted_receipt_set_digest: indexerDigestSchema,
  post_author_envelope: z.object({
    state: z.enum(["not-required", "current", "stale"]),
    digest: indexerDigestSchema.nullable(),
  }).strict(),
  outcome: z.enum([
    "complete",
    "index-post-author-workset-pending",
    "index-post-author-workset-failed",
    "index-post-author-workset-stale",
    "index-post-author-envelope-stale",
  ]),
  can_reconcile: z.boolean(),
  status_digest: indexerDigestSchema,
}).strict();

export type IndexerPostAuthorStatus = z.infer<typeof indexerPostAuthorStatusSchema>;

type StatusPayload = Omit<IndexerPostAuthorStatus, "status_digest">;

function sameEnvelope(
  candidate: unknown,
  expected: IndexerComposedResultEnvelope,
): candidate is IndexerComposedResultEnvelope {
  const parsed = indexerComposedResultEnvelopeSchema.safeParse(candidate);
  return parsed.success &&
    indexerProtocolDigest(parsed.data) === indexerProtocolDigest(expected);
}

export function observeIndexerPostAuthorState(input: {
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
  effective_composer_set: z.infer<typeof indexerEffectiveComposerSetSchema>;
  validator_contract_digest: string;
  accepted_input_view_digest: string;
  current_envelope?: unknown;
}): {
  ledger: IndexerPostAuthorRunLedger;
  status: IndexerPostAuthorStatus;
  expected_envelope: IndexerComposedResultEnvelope | null;
} {
  const ledger = recoverIndexerPostAuthorRunLedger({
    plan: input.plan,
    previous_ledger: input.ledger,
    validator_contract_digest: input.validator_contract_digest,
  });
  const effectiveSet = validateIndexerEffectiveComposerSet(
    input.effective_composer_set,
  );
  if (
    effectiveSet.effective_composer_set_digest !==
      input.plan.workset_set.effective_composer_set_digest
  ) {
    throw new TypeError("post-author plan does not match the effective composer set");
  }
  if (input.plan.state === "pending") {
    const expectedEntries = input.plan.worksets.map((workset) => ({
      composer_ref: workset.composer_ref,
      composer_selection_entry_digest: workset.composer_selection_entry_digest,
      target_layer_ref: workset.target_layer_ref,
      target_layer_integrity: workset.target_layer_integrity,
      target_bundle_digest: workset.target_bundle_digest,
    }));
    const actualEntries = effectiveSet.entries.map((entry) => ({
      composer_ref: entry.composer_ref,
      composer_selection_entry_digest: entry.composer_selection_entry_digest,
      target_layer_ref: entry.target_layer_ref,
      target_layer_integrity: entry.target_layer_integrity,
      target_bundle_digest: entry.target_bundle_digest,
    }));
    if (indexerProtocolDigest(expectedEntries) !== indexerProtocolDigest(actualEntries)) {
      throw new TypeError("post-author worksets do not match the effective composer entries");
    }
  }
  if (input.plan.state === "not-required") {
    if (input.current_envelope !== undefined) {
      throw new TypeError("zero composer selection must not publish an envelope");
    }
    const payload: StatusPayload = {
      protocol: "context.indexer.post-author-status/v1",
      workset_set_digest: input.plan.workset_set.workset_set_digest,
      total_count: 0,
      pending_count: 0,
      accepted_count: 0,
      failed_count: 0,
      stale_count: 0,
      next_refs: [],
      accepted_receipt_set_digest: indexerProtocolDigest({
        protocol: "context.indexer.accepted-composer-receipt-set/v1",
        receipts: [],
      }),
      post_author_envelope: { state: "not-required", digest: null },
      outcome: "complete",
      can_reconcile: true,
    };
    return {
      ledger,
      status: indexerPostAuthorStatusSchema.parse({
        ...payload,
        status_digest: indexerProtocolDigest(payload),
      }),
      expected_envelope: null,
    };
  }
  const counts = {
    pending: ledger.entries.filter((entry) => entry.state === "pending").length,
    accepted: ledger.entries.filter((entry) => entry.state === "accepted").length,
    failed: ledger.entries.filter((entry) => entry.state === "failed").length,
    stale: ledger.entries.filter((entry) => entry.state === "stale").length,
  };
  const nextRefs = ledger.entries.filter(
    (entry): entry is Extract<
      IndexerPostAuthorRunLedgerEntry,
      { state: "pending" | "failed" | "stale" }
    > => entry.state === "pending" || entry.state === "failed" || entry.state === "stale",
  ).map((entry) => ({
    composer_ref: entry.composer_ref,
    workset_digest: entry.workset_digest,
    state: entry.state,
  }));
  const accepted = ledger.entries.filter(
    (entry): entry is z.infer<typeof acceptedEntrySchema> => entry.state === "accepted",
  );
  const acceptedReceiptSetDigest = indexerProtocolDigest({
    protocol: "context.indexer.accepted-composer-receipt-set/v1",
    receipts: accepted.map((entry) => entry.receipt),
  });
  const allAccepted = counts.accepted === ledger.entries.length;
  let expectedEnvelope: IndexerComposedResultEnvelope | null = null;
  let envelopeState: "current" | "stale" = "stale";
  let envelopeDigest: string | null = null;
  if (allAccepted) {
    expectedEnvelope = composeIndexerPostAuthorEnvelope({
      workset_digest: input.plan.primary_result_view.workset_digest,
      primary_result_digest: input.plan.primary_result_view.primary_result_digest,
      primary_result_view: input.plan.primary_result_view,
      accepted_input_view_digest: input.accepted_input_view_digest,
      effective_composer_set: effectiveSet,
      invocations: accepted.map((entry) => ({
        receipt: entry.receipt,
        fragments: entry.fragments,
      })),
    });
    if (sameEnvelope(input.current_envelope, expectedEnvelope)) {
      envelopeState = "current";
      envelopeDigest = expectedEnvelope.composition_fingerprint;
    }
  }
  if (envelopeState === "stale" && input.current_envelope !== undefined) {
    const parsed = indexerComposedResultEnvelopeSchema.safeParse(input.current_envelope);
    envelopeDigest = parsed.success ? parsed.data.composition_fingerprint : null;
  }
  const outcome = counts.failed > 0
    ? "index-post-author-workset-failed" as const
    : counts.stale > 0
    ? "index-post-author-workset-stale" as const
    : counts.pending > 0
    ? "index-post-author-workset-pending" as const
    : envelopeState !== "current"
    ? "index-post-author-envelope-stale" as const
    : "complete" as const;
  const payload: StatusPayload = {
    protocol: "context.indexer.post-author-status/v1",
    workset_set_digest: input.plan.workset_set.workset_set_digest,
    total_count: ledger.entries.length,
    pending_count: counts.pending,
    accepted_count: counts.accepted,
    failed_count: counts.failed,
    stale_count: counts.stale,
    next_refs: nextRefs,
    accepted_receipt_set_digest: acceptedReceiptSetDigest,
    post_author_envelope: { state: envelopeState, digest: envelopeDigest },
    outcome,
    can_reconcile: outcome === "complete",
  };
  return {
    ledger,
    status: indexerPostAuthorStatusSchema.parse({
      ...payload,
      status_digest: indexerProtocolDigest(payload),
    }),
    expected_envelope: expectedEnvelope,
  };
}
