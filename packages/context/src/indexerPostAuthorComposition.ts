import { z } from "zod";
import {
  indexerCanonicalRefSchema,
  indexerComposerRefSchema,
  indexerEvidenceRefSchema,
  indexerMaterializedLayerFragmentSchema,
  indexerProviderLayerRefSchema,
  validateAndMaterializeIndexerLayerFragment,
  validateIndexerMaterializedLayerFragment,
  type IndexerMaterializedLayerFragment,
} from "./indexerLayerComposition.js";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import type { IndexerJson } from "./indexerRegistry.js";
import { indexerComposerContractSchema } from "./indexerProvider.js";
import { indexerSubjectKeySchema } from "./indexerSubjectIdentity.js";

function withoutField<T extends object, K extends keyof T>(
  value: T,
  field: K,
): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  ) as Omit<T, K>;
}

const canonicalJsonSchema: z.ZodType<IndexerJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(canonicalJsonSchema),
    z.record(canonicalJsonSchema),
  ])
);

const evidenceRefsSchema = z.array(indexerEvidenceRefSchema).superRefine(
  (value, context) => addDuplicateIssues(
    value.map((item) => item.ref),
    context,
    "evidence_refs",
  ),
);

const primaryFactSchema = z.object({
  fact_ref: indexerCanonicalRefSchema,
  subject_key: indexerSubjectKeySchema,
  fact_kind: indexerIdSchema,
  value: canonicalJsonSchema,
  evidence_refs: evidenceRefsSchema,
}).strict();

const primaryArtifactSchema = z.object({
  artifact_ref: indexerCanonicalRefSchema,
  subject_key: indexerSubjectKeySchema,
  artifact_kind: indexerIdSchema,
  artifact_policy_variant: indexerIdSchema,
  variables: z.record(canonicalJsonSchema),
  evidence_refs: evidenceRefsSchema,
}).strict();

const primaryResultViewReceiptSchema = z.object({
  protocol: z.literal(
    "context.indexer.primary-result-view-materialization-receipt/v1",
  ),
  workset_digest: indexerDigestSchema,
  primary_result_digest: indexerDigestSchema,
  view_digest: indexerDigestSchema,
  validator_contract_digest: indexerDigestSchema,
}).strict();

export const indexerPrimaryResultViewSchema = z.object({
  protocol: z.literal("context.indexer.primary-result-view/v1"),
  workset_digest: indexerDigestSchema,
  primary_result_digest: indexerDigestSchema,
  primary_result_protocol: z.literal("context.indexer.main-result/v1"),
  facts: z.array(primaryFactSchema),
  artifacts: z.array(primaryArtifactSchema),
  view_digest: indexerDigestSchema,
  materialization_receipt: primaryResultViewReceiptSchema,
}).strict();

export type IndexerPrimaryFactView = z.infer<typeof primaryFactSchema>;
export type IndexerPrimaryArtifactView = z.infer<typeof primaryArtifactSchema>;
export type IndexerPrimaryResultView = z.infer<typeof indexerPrimaryResultViewSchema>;

type PrimaryResultViewContent = Omit<
  IndexerPrimaryResultView,
  "view_digest" | "materialization_receipt"
>;

export function indexerPrimaryResultViewDigest(
  view: PrimaryResultViewContent,
): string {
  return indexerProtocolDigest(view);
}

function assertCanonicalEvidenceOrder(
  items: readonly { evidence_refs: Array<{ ref: string }> }[],
): void {
  for (const item of items) {
    const refs = item.evidence_refs.map((evidence) => evidence.ref);
    if (refs.some((value, index) => [...refs].sort()[index] !== value)) {
      throw new TypeError("PrimaryResultView evidence refs must use canonical ordering");
    }
  }
}

export function materializeIndexerPrimaryResultView(input: {
  workset_digest: string;
  primary_result_digest: string;
  facts: readonly IndexerPrimaryFactView[];
  artifacts: readonly IndexerPrimaryArtifactView[];
  validator_contract_digest: string;
}): IndexerPrimaryResultView {
  const facts = input.facts.map((item) => primaryFactSchema.parse(item))
    .sort((left, right) => compareIndexerCanonicalText(left.fact_ref, right.fact_ref));
  const artifacts = input.artifacts.map((item) => primaryArtifactSchema.parse(item))
    .sort((left, right) =>
      compareIndexerCanonicalText(left.artifact_ref, right.artifact_ref)
    );
  if (new Set(facts.map((item) => item.fact_ref)).size !== facts.length) {
    throw new TypeError("PrimaryResultView fact_ref values must be unique");
  }
  if (new Set(artifacts.map((item) => item.artifact_ref)).size !== artifacts.length) {
    throw new TypeError("PrimaryResultView artifact_ref values must be unique");
  }
  assertCanonicalEvidenceOrder([...facts, ...artifacts]);
  const content: PrimaryResultViewContent = {
    protocol: "context.indexer.primary-result-view/v1",
    workset_digest: input.workset_digest,
    primary_result_digest: input.primary_result_digest,
    primary_result_protocol: "context.indexer.main-result/v1",
    facts,
    artifacts,
  };
  const viewDigest = indexerPrimaryResultViewDigest(content);
  return indexerPrimaryResultViewSchema.parse({
    ...content,
    view_digest: viewDigest,
    materialization_receipt: {
      protocol: "context.indexer.primary-result-view-materialization-receipt/v1",
      workset_digest: input.workset_digest,
      primary_result_digest: input.primary_result_digest,
      view_digest: viewDigest,
      validator_contract_digest: input.validator_contract_digest,
    },
  });
}

export function validateIndexerPrimaryResultView(
  value: unknown,
): IndexerPrimaryResultView {
  const view = indexerPrimaryResultViewSchema.parse(value);
  const content: PrimaryResultViewContent = {
    protocol: view.protocol,
    workset_digest: view.workset_digest,
    primary_result_digest: view.primary_result_digest,
    primary_result_protocol: view.primary_result_protocol,
    facts: view.facts,
    artifacts: view.artifacts,
  };
  if (indexerPrimaryResultViewDigest(content) !== view.view_digest) {
    throw new TypeError("PrimaryResultView digest is invalid");
  }
  const receipt = view.materialization_receipt;
  if (
    receipt.workset_digest !== view.workset_digest ||
    receipt.primary_result_digest !== view.primary_result_digest ||
    receipt.view_digest !== view.view_digest
  ) {
    throw new TypeError("PrimaryResultView materialization receipt is invalid");
  }
  const rebuilt = materializeIndexerPrimaryResultView({
    workset_digest: view.workset_digest,
    primary_result_digest: view.primary_result_digest,
    facts: view.facts,
    artifacts: view.artifacts,
    validator_contract_digest: receipt.validator_contract_digest,
  });
  if (rebuilt.view_digest !== view.view_digest) {
    throw new TypeError("PrimaryResultView payload does not use canonical ordering");
  }
  return view;
}

const composerSelectionSchema = z.object({
  id: indexerIdSchema,
  provider: indexerIdSchema,
  composer_selection_entry_digest: indexerDigestSchema,
}).strict();

const composerManifestLayerSchema = z.object({
  provider: indexerIdSchema,
  layer_ref: indexerProviderLayerRefSchema,
  layer_integrity: indexerDigestSchema,
  bundle_digest: indexerDigestSchema,
  composers: z.array(z.object({
    id: indexerIdSchema,
    supported_profiles: z.array(indexerIdSchema).min(1),
    contract: indexerComposerContractSchema.optional(),
  }).strict()),
}).strict();

export const indexerEffectiveComposerSchema = z.object({
  composer_ref: indexerComposerRefSchema,
  composer_id: indexerIdSchema,
  provider: indexerIdSchema,
  composer_selection_entry_digest: indexerDigestSchema,
  target_layer_ref: indexerProviderLayerRefSchema,
  target_layer_integrity: indexerDigestSchema,
  target_bundle_digest: indexerDigestSchema,
  composer_contract_digest: indexerDigestSchema.optional(),
}).strict();

export type IndexerEffectiveComposer = z.infer<typeof indexerEffectiveComposerSchema>;

export const indexerEffectiveComposerSetSchema = z.object({
  protocol: z.literal("context.indexer.effective-composer-set/v1"),
  entries: z.array(indexerEffectiveComposerSchema),
  effective_composer_set_digest: indexerDigestSchema,
}).strict();

export type IndexerEffectiveComposerSet = z.infer<
  typeof indexerEffectiveComposerSetSchema
>;

export function validateIndexerEffectiveComposerSet(
  value: unknown,
): IndexerEffectiveComposerSet {
  const set = indexerEffectiveComposerSetSchema.parse(value);
  const refs = set.entries.map((item) => item.composer_ref);
  if (new Set(refs).size !== refs.length) {
    throw new TypeError("effective composer refs must be unique");
  }
  if (refs.some((value, index) => [...refs].sort()[index] !== value)) {
    throw new TypeError("effective composer entries must use canonical ordering");
  }
  if (
    indexerProtocolDigest(withoutField(set, "effective_composer_set_digest")) !==
      set.effective_composer_set_digest
  ) {
    throw new TypeError("effective composer set digest is invalid");
  }
  return set;
}

export function resolveEffectiveIndexerComposers(input: {
  selections: readonly z.infer<typeof composerSelectionSchema>[];
  manifest_layers: readonly z.infer<typeof composerManifestLayerSchema>[];
  current_profiles: readonly string[];
}): IndexerEffectiveComposerSet {
  const selections = input.selections.map((item) => composerSelectionSchema.parse(item));
  const layers = input.manifest_layers.map((item) => composerManifestLayerSchema.parse(item));
  if (new Set(selections.map((item) => `${item.provider}\u0000${item.id}`)).size !== selections.length) {
    throw new TypeError("composer registry selections must be unique");
  }
  if (new Set(layers.map((item) => item.provider)).size !== layers.length) {
    throw new TypeError("composer manifest provider layers must be unique");
  }
  for (const layer of layers) {
    if (new Set(layer.composers.map((item) => item.id)).size !== layer.composers.length) {
      throw new TypeError(`composer manifest ids must be unique for ${layer.provider}`);
    }
  }
  const profiles = new Set(input.current_profiles);
  const entries = selections.map((selection) => {
    const layer = layers.find((item) => item.provider === selection.provider);
    const composer = layer?.composers.find((item) => item.id === selection.id);
    if (
      layer === undefined ||
      composer === undefined ||
      !composer.supported_profiles.some((profile) => profiles.has(profile))
    ) {
      throw new TypeError(
        `indexer-composer-not-enabled: ${selection.provider}/${selection.id}`,
      );
    }
    return indexerEffectiveComposerSchema.parse({
      composer_ref: `${layer.layer_ref}#composer:${composer.id}`,
      composer_id: composer.id,
      provider: selection.provider,
      composer_selection_entry_digest: selection.composer_selection_entry_digest,
      target_layer_ref: layer.layer_ref,
      target_layer_integrity: layer.layer_integrity,
      target_bundle_digest: layer.bundle_digest,
      ...(composer.contract === undefined
        ? {}
        : { composer_contract_digest: indexerProtocolDigest(composer.contract) }),
    });
  }).sort((left, right) =>
    compareIndexerCanonicalText(left.composer_ref, right.composer_ref)
  );
  const payload = {
    protocol: "context.indexer.effective-composer-set/v1" as const,
    entries,
  };
  return indexerEffectiveComposerSetSchema.parse({
    ...payload,
    effective_composer_set_digest: indexerProtocolDigest(payload),
  });
}

export const indexerPostAuthorWorksetSchema = z.object({
  protocol: z.literal("context.indexer.post-author-workset/v1"),
  workset_digest: indexerDigestSchema,
  author_workset_digest: indexerDigestSchema,
  primary_result_digest: indexerDigestSchema,
  primary_result_view_digest: indexerDigestSchema,
  composer_ref: indexerComposerRefSchema,
  composer_selection_entry_digest: indexerDigestSchema,
  target_layer_ref: indexerProviderLayerRefSchema,
  target_layer_integrity: indexerDigestSchema,
  target_bundle_digest: indexerDigestSchema,
  composer_contract_digest: indexerDigestSchema.optional(),
  current_profile_binding_digest: indexerDigestSchema,
  composer_execution_fingerprint: indexerDigestSchema,
  allowed_target_refs: z.array(indexerCanonicalRefSchema),
}).strict();

export type IndexerPostAuthorWorkset = z.infer<typeof indexerPostAuthorWorksetSchema>;

export function indexerPostAuthorWorksetDigest(
  workset: Omit<IndexerPostAuthorWorkset, "workset_digest">,
): string {
  return indexerProtocolDigest(workset);
}

export const indexerPostAuthorWorksetSetSchema = z.object({
  protocol: z.literal("context.indexer.post-author-workset-set/v1"),
  workset_set_digest: indexerDigestSchema,
  effective_composer_set_digest: indexerDigestSchema,
  primary_result_view_digest: indexerDigestSchema.optional(),
  items: z.array(z.object({
    workset_digest: indexerDigestSchema,
    composer_ref: indexerComposerRefSchema,
    composer_selection_entry_digest: indexerDigestSchema,
  }).strict()),
}).strict();

export type IndexerPostAuthorWorksetSet = z.infer<
  typeof indexerPostAuthorWorksetSetSchema
>;

export function indexerPostAuthorWorksetSetDigest(
  value: Omit<IndexerPostAuthorWorksetSet, "workset_set_digest">,
): string {
  return indexerProtocolDigest(value);
}

export type IndexerPostAuthorPlan =
  | {
      state: "not-required";
      primary_result_view: null;
      worksets: [];
      workset_set: IndexerPostAuthorWorksetSet;
    }
  | {
      state: "pending";
      primary_result_view: IndexerPrimaryResultView;
      worksets: IndexerPostAuthorWorkset[];
      workset_set: IndexerPostAuthorWorksetSet;
    };

export function planIndexerPostAuthorComposition(input: {
  effective_composer_set: IndexerEffectiveComposerSet;
  author_workset_digest: string;
  primary_result_digest: string;
  primary_facts: readonly IndexerPrimaryFactView[];
  primary_artifacts: readonly IndexerPrimaryArtifactView[];
  validator_contract_digest: string;
  current_profile_binding_digest: string;
  allowed_target_refs: readonly string[];
}): IndexerPostAuthorPlan {
  const effective = validateIndexerEffectiveComposerSet(input.effective_composer_set);
  if (effective.entries.length === 0) {
    const payload: Omit<IndexerPostAuthorWorksetSet, "workset_set_digest"> = {
      protocol: "context.indexer.post-author-workset-set/v1",
      effective_composer_set_digest: effective.effective_composer_set_digest,
      items: [],
    };
    return {
      state: "not-required",
      primary_result_view: null,
      worksets: [],
      workset_set: {
        ...payload,
        workset_set_digest: indexerPostAuthorWorksetSetDigest(payload),
      },
    };
  }
  const primaryResultView = materializeIndexerPrimaryResultView({
    workset_digest: input.author_workset_digest,
    primary_result_digest: input.primary_result_digest,
    facts: input.primary_facts,
    artifacts: input.primary_artifacts,
    validator_contract_digest: input.validator_contract_digest,
  });
  const allowedTargets = [...new Set(input.allowed_target_refs)].sort();
  const worksets = effective.entries.map((entry) => {
    const content = {
      protocol: "context.indexer.post-author-workset/v1" as const,
      author_workset_digest: input.author_workset_digest,
      primary_result_digest: input.primary_result_digest,
      primary_result_view_digest: primaryResultView.view_digest,
      composer_ref: entry.composer_ref,
      composer_selection_entry_digest: entry.composer_selection_entry_digest,
      target_layer_ref: entry.target_layer_ref,
      target_layer_integrity: entry.target_layer_integrity,
      target_bundle_digest: entry.target_bundle_digest,
      ...(entry.composer_contract_digest === undefined
        ? {}
        : { composer_contract_digest: entry.composer_contract_digest }),
      current_profile_binding_digest: input.current_profile_binding_digest,
      composer_execution_fingerprint: indexerProtocolDigest({
        composer_ref: entry.composer_ref,
        composer_selection_entry_digest: entry.composer_selection_entry_digest,
        ...(entry.composer_contract_digest === undefined
          ? {}
          : { composer_contract_digest: entry.composer_contract_digest }),
        current_profile_binding_digest: input.current_profile_binding_digest,
        primary_result_view_digest: primaryResultView.view_digest,
      }),
      allowed_target_refs: allowedTargets,
    };
    return indexerPostAuthorWorksetSchema.parse({
      ...content,
      workset_digest: indexerPostAuthorWorksetDigest(content),
    });
  });
  const setPayload: Omit<IndexerPostAuthorWorksetSet, "workset_set_digest"> = {
    protocol: "context.indexer.post-author-workset-set/v1",
    effective_composer_set_digest: effective.effective_composer_set_digest,
    primary_result_view_digest: primaryResultView.view_digest,
    items: worksets.map((workset) => ({
      workset_digest: workset.workset_digest,
      composer_ref: workset.composer_ref,
      composer_selection_entry_digest: workset.composer_selection_entry_digest,
    })),
  };
  return {
    state: "pending",
    primary_result_view: primaryResultView,
    worksets,
    workset_set: indexerPostAuthorWorksetSetSchema.parse({
      ...setPayload,
      workset_set_digest: indexerPostAuthorWorksetSetDigest(setPayload),
    }),
  };
}

export const indexerPostAuthorFragmentRequestSchema = z.object({
  protocol: z.literal("context.indexer.layer-fragment-request/v1"),
  operation: z.literal("main-index"),
  phase: z.literal("post-author"),
  target_layer_ref: indexerProviderLayerRefSchema,
  target_layer_integrity: indexerDigestSchema,
  target_bundle_digest: indexerDigestSchema,
  allowed_fragment_kinds: z.tuple([z.literal("derived-artifact-proposal")]),
  allowed_target_refs: z.array(indexerCanonicalRefSchema),
  workset: indexerPostAuthorWorksetSchema,
  composer_ref: indexerComposerRefSchema,
  composer_selection_entry_digest: indexerDigestSchema,
  current_profile_binding_digest: indexerDigestSchema,
  primary_result_view: indexerPrimaryResultViewSchema,
  request_digest: indexerDigestSchema,
}).strict();

export type IndexerPostAuthorFragmentRequest = z.infer<
  typeof indexerPostAuthorFragmentRequestSchema
>;

export function validateIndexerPostAuthorFragmentRequest(
  value: unknown,
): IndexerPostAuthorFragmentRequest {
  const request = indexerPostAuthorFragmentRequestSchema.parse(value);
  if (indexerProtocolDigest(withoutField(request, "request_digest")) !== request.request_digest) {
    throw new TypeError("post-author fragment request digest is invalid");
  }
  const workset = request.workset;
  if (
    indexerPostAuthorWorksetDigest(withoutField(workset, "workset_digest")) !==
      workset.workset_digest
  ) {
    throw new TypeError("post-author workset digest is invalid");
  }
  const view = validateIndexerPrimaryResultView(request.primary_result_view);
  if (
    request.target_layer_ref !== workset.target_layer_ref ||
    request.target_layer_integrity !== workset.target_layer_integrity ||
    request.target_bundle_digest !== workset.target_bundle_digest ||
    request.composer_ref !== workset.composer_ref ||
    request.composer_selection_entry_digest !==
      workset.composer_selection_entry_digest ||
    request.current_profile_binding_digest !== workset.current_profile_binding_digest ||
    request.primary_result_view.view_digest !== workset.primary_result_view_digest ||
    view.primary_result_digest !== workset.primary_result_digest ||
    view.workset_digest !== workset.author_workset_digest
  ) {
    throw new TypeError("post-author request fields do not match its workset and view");
  }
  return request;
}

export function buildIndexerPostAuthorFragmentRequest(input: {
  workset: IndexerPostAuthorWorkset;
  primary_result_view: IndexerPrimaryResultView;
}): IndexerPostAuthorFragmentRequest {
  const workset = indexerPostAuthorWorksetSchema.parse(input.workset);
  const view = validateIndexerPrimaryResultView(input.primary_result_view);
  if (
    workset.primary_result_view_digest !== view.view_digest ||
    workset.primary_result_digest !== view.primary_result_digest ||
    workset.author_workset_digest !== view.workset_digest
  ) {
    throw new TypeError("post-author workset is bound to another PrimaryResultView");
  }
  const payload = {
    protocol: "context.indexer.layer-fragment-request/v1" as const,
    operation: "main-index" as const,
    phase: "post-author" as const,
    target_layer_ref: workset.target_layer_ref,
    target_layer_integrity: workset.target_layer_integrity,
    target_bundle_digest: workset.target_bundle_digest,
    allowed_fragment_kinds: ["derived-artifact-proposal"] as const,
    allowed_target_refs: workset.allowed_target_refs,
    workset,
    composer_ref: workset.composer_ref,
    composer_selection_entry_digest: workset.composer_selection_entry_digest,
    current_profile_binding_digest: workset.current_profile_binding_digest,
    primary_result_view: view,
  };
  return indexerPostAuthorFragmentRequestSchema.parse({
    ...payload,
    request_digest: indexerProtocolDigest(payload),
  });
}

export const indexerLayerFragmentRunResultSchema = z.object({
  protocol: z.literal("context.indexer.layer-fragment-result/v1"),
  request_digest: indexerDigestSchema,
  composer_ref: indexerComposerRefSchema.optional(),
  consumed_primary_result_view_digest: indexerDigestSchema.optional(),
  fragments: z.array(z.unknown()),
  result_digest: indexerDigestSchema,
}).strict();

export type IndexerLayerFragmentRunResult = z.infer<
  typeof indexerLayerFragmentRunResultSchema
>;

export const indexerComposerInvocationReceiptSchema = z.object({
  protocol: z.literal("context.indexer.composer-invocation-receipt/v1"),
  composer_ref: indexerComposerRefSchema,
  composer_selection_entry_digest: indexerDigestSchema,
  layer_ref: indexerProviderLayerRefSchema,
  layer_integrity: indexerDigestSchema,
  request_digest: indexerDigestSchema,
  primary_result_view_digest: indexerDigestSchema,
  consumed_primary_result_view_digest: indexerDigestSchema,
  result_digest: indexerDigestSchema,
  fragment_digests: z.array(indexerDigestSchema),
}).strict();

export type IndexerComposerInvocationReceipt = z.infer<
  typeof indexerComposerInvocationReceiptSchema
>;

export function validateIndexerPostAuthorFragmentResult(input: {
  request: IndexerPostAuthorFragmentRequest;
  result: unknown;
  validator_contract_digest: string;
}): {
  result: IndexerLayerFragmentRunResult;
  fragments: IndexerMaterializedLayerFragment[];
  receipt: IndexerComposerInvocationReceipt;
} {
  const request = validateIndexerPostAuthorFragmentRequest(input.request);
  const result = indexerLayerFragmentRunResultSchema.parse(input.result);
  const resultPayload = {
    protocol: result.protocol,
    request_digest: result.request_digest,
    composer_ref: result.composer_ref,
    consumed_primary_result_view_digest: result.consumed_primary_result_view_digest,
    fragments: result.fragments,
  };
  if (indexerProtocolDigest(resultPayload) !== result.result_digest) {
    throw new TypeError("layer fragment result digest is invalid");
  }
  if (
    result.request_digest !== request.request_digest ||
    result.composer_ref !== request.composer_ref ||
    result.consumed_primary_result_view_digest !== request.primary_result_view.view_digest
  ) {
    throw new TypeError("post-author fragment result does not match its composer request");
  }
  const fragments = result.fragments.map((fragment) =>
    validateAndMaterializeIndexerLayerFragment({
      fragment,
      expected_workset_digest: request.workset.workset_digest,
      expected_layer_ref: request.target_layer_ref,
      expected_layer_integrity: request.target_layer_integrity,
      expected_composer_ref: request.composer_ref,
      allowed_kinds: request.allowed_fragment_kinds,
      allowed_target_refs: request.allowed_target_refs,
      validator_contract_digest: input.validator_contract_digest,
    })
  ).sort((left, right) =>
    compareIndexerCanonicalText(left.fragment_digest, right.fragment_digest)
  );
  const receipt = indexerComposerInvocationReceiptSchema.parse({
    protocol: "context.indexer.composer-invocation-receipt/v1",
    composer_ref: request.composer_ref,
    composer_selection_entry_digest: request.composer_selection_entry_digest,
    layer_ref: request.target_layer_ref,
    layer_integrity: request.target_layer_integrity,
    request_digest: request.request_digest,
    primary_result_view_digest: request.primary_result_view.view_digest,
    consumed_primary_result_view_digest: result.consumed_primary_result_view_digest,
    result_digest: result.result_digest,
    fragment_digests: fragments.map((fragment) => fragment.fragment_digest),
  });
  return { result, fragments, receipt };
}

export const indexerComposedResultEnvelopeSchema = z.object({
  protocol: z.literal("context.indexer.composed-result-envelope/v1"),
  workset_digest: indexerDigestSchema,
  primary_result_digest: indexerDigestSchema,
  primary_result_view_digest: indexerDigestSchema,
  accepted_input_view_digest: indexerDigestSchema,
  effective_composer_set_digest: indexerDigestSchema,
  accepted_post_author_fragments: z.array(indexerMaterializedLayerFragmentSchema),
  composer_invocation_receipts: z.array(indexerComposerInvocationReceiptSchema),
  composition_fingerprint: indexerDigestSchema,
}).strict();

export type IndexerComposedResultEnvelope = z.infer<
  typeof indexerComposedResultEnvelopeSchema
>;

export function composeIndexerPostAuthorEnvelope(input: {
  workset_digest: string;
  primary_result_digest: string;
  primary_result_view: IndexerPrimaryResultView;
  accepted_input_view_digest: string;
  effective_composer_set: IndexerEffectiveComposerSet;
  invocations: readonly {
    receipt: IndexerComposerInvocationReceipt;
    fragments: readonly IndexerMaterializedLayerFragment[];
  }[];
}): IndexerComposedResultEnvelope {
  if (input.effective_composer_set.entries.length === 0) {
    throw new TypeError("zero composer selection must publish not-required without an envelope");
  }
  const view = validateIndexerPrimaryResultView(input.primary_result_view);
  const effectiveSet = validateIndexerEffectiveComposerSet(input.effective_composer_set);
  const expectedRefs = effectiveSet.entries.map((item) => item.composer_ref).sort();
  const invocations = input.invocations.map((item) => ({
    receipt: indexerComposerInvocationReceiptSchema.parse(item.receipt),
    fragments: item.fragments.map((fragment) =>
      validateIndexerMaterializedLayerFragment(fragment)
    ),
  })).sort((left, right) =>
    compareIndexerCanonicalText(left.receipt.composer_ref, right.receipt.composer_ref)
  );
  const actualRefs = invocations.map((item) => item.receipt.composer_ref);
  if (
    expectedRefs.length !== actualRefs.length ||
    expectedRefs.some((value, index) => actualRefs[index] !== value)
  ) {
    throw new TypeError("post-author envelope requires one receipt per effective composer");
  }
  for (const invocation of invocations) {
    const effective = effectiveSet.entries.find(
      (entry) => entry.composer_ref === invocation.receipt.composer_ref,
    )!;
    if (
      invocation.receipt.composer_selection_entry_digest !==
        effective.composer_selection_entry_digest ||
      invocation.receipt.layer_ref !== effective.target_layer_ref ||
      invocation.receipt.layer_integrity !== effective.target_layer_integrity ||
      invocation.receipt.primary_result_view_digest !== view.view_digest ||
      invocation.receipt.consumed_primary_result_view_digest !== view.view_digest
    ) {
      throw new TypeError("composer invocation receipt is bound to another authority or view");
    }
    const fragmentDigests = invocation.fragments.map((item) => item.fragment_digest).sort();
    if (
      fragmentDigests.length !== invocation.receipt.fragment_digests.length ||
      fragmentDigests.some(
        (value, index) => invocation.receipt.fragment_digests[index] !== value,
      )
    ) {
      throw new TypeError("composer invocation receipt fragment set is incomplete");
    }
    if (invocation.fragments.some((fragment) =>
      fragment.composer_ref !== invocation.receipt.composer_ref ||
      fragment.phase !== "post-author" ||
      fragment.kind !== "derived-artifact-proposal"
    )) {
      throw new TypeError("post-author fragment does not match its invocation receipt");
    }
  }
  const receipts = invocations.map((item) => item.receipt);
  const fragments = invocations.flatMap((item) => item.fragments).sort((left, right) =>
    compareIndexerCanonicalText(
      `${left.composer_ref}\u0000${left.fragment_digest}`,
      `${right.composer_ref}\u0000${right.fragment_digest}`,
    )
  );
  const fingerprintPayload = {
    workset_digest: input.workset_digest,
    primary_result_digest: input.primary_result_digest,
    accepted_input_view_digest: input.accepted_input_view_digest,
    effective_composer_set_digest:
      effectiveSet.effective_composer_set_digest,
    primary_result_view_digest: view.view_digest,
    composer_invocation_receipts: receipts,
    accepted_post_author_fragments: fragments,
  };
  return indexerComposedResultEnvelopeSchema.parse({
    protocol: "context.indexer.composed-result-envelope/v1",
    ...fingerprintPayload,
    composition_fingerprint: indexerProtocolDigest(fingerprintPayload),
  });
}
