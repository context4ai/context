import { z } from "zod";
import {
  INDEXER_EVIDENCE_KINDS,
  INDEXER_LAYER_FRAGMENT_KINDS,
  addDuplicateIssues,
  compareIndexerCanonicalText,
  formatIndexerSchemaIssues,
  indexerCanonicalRefSchema,
  indexerComposerRefSchema,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerProviderLayerRefSchema,
} from "./indexerProtocolCommon.js";
import { indexerArtifactSchema } from "./indexerArtifact.js";
import type { IndexerJson } from "./indexerRegistry.js";

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

export {
  indexerCanonicalRefSchema,
  indexerComposerRefSchema,
  indexerProviderLayerRefSchema,
} from "./indexerProtocolCommon.js";

export const indexerEvidenceRefSchema = z.object({
  ref: indexerCanonicalRefSchema,
  kind: z.enum(INDEXER_EVIDENCE_KINDS),
  source_digest: indexerDigestSchema,
}).strict();

const evidenceRefsSchema = z.array(indexerEvidenceRefSchema).superRefine((value, context) => {
  addDuplicateIssues(value.map((item) => item.ref), context, "evidence_refs");
});

const nonEmptyEvidenceRefsSchema = z.array(indexerEvidenceRefSchema).min(1)
  .superRefine((value, context) => {
    addDuplicateIssues(value.map((item) => item.ref), context, "evidence_refs");
  });

const factEnrichmentSchema = z.object({
  target_ref: indexerCanonicalRefSchema,
  fact_id: indexerIdSchema,
  value: canonicalJsonSchema,
  evidence_refs: evidenceRefsSchema,
}).strict();

const templateVariableBindingSchema = z.object({
  target_ref: indexerCanonicalRefSchema,
  template_id: indexerIdSchema,
  variable_id: indexerIdSchema,
  value: canonicalJsonSchema,
  evidence_refs: evidenceRefsSchema,
}).strict();

const derivedArtifactProposalSchema = z.object({
  composer_ref: indexerComposerRefSchema,
  target_node_ref: indexerCanonicalRefSchema,
  artifact: indexerArtifactSchema,
  evidence_refs: nonEmptyEvidenceRefsSchema,
}).strict();

const factPayloadSchema = z.object({
  protocol: z.literal("context.indexer.fragment.fact-enrichment/v1"),
  facts: z.array(factEnrichmentSchema),
}).strict();

const variablePayloadSchema = z.object({
  protocol: z.literal("context.indexer.fragment.template-variables/v1"),
  variables: z.array(templateVariableBindingSchema),
}).strict();

const artifactPayloadSchema = z.object({
  protocol: z.literal("context.indexer.fragment.derived-artifact-proposal/v1"),
  proposals: z.array(derivedArtifactProposalSchema),
}).strict();

export const indexerLayerFragmentPayloadSchema = z.union([
  factPayloadSchema,
  variablePayloadSchema,
  artifactPayloadSchema,
]);

export const indexerLayerFragmentSchema = z.object({
  protocol: z.literal("context.indexer.layer-fragment/v1"),
  workset_digest: indexerDigestSchema,
  layer_ref: indexerProviderLayerRefSchema,
  layer_integrity: indexerDigestSchema,
  composer_ref: indexerComposerRefSchema.optional(),
  phase: z.enum(["pre-authority", "post-author"]),
  kind: z.enum(INDEXER_LAYER_FRAGMENT_KINDS),
  target_refs: z.array(indexerCanonicalRefSchema),
  payload: indexerLayerFragmentPayloadSchema,
  fragment_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.target_refs, context, "target_refs");
  const expected = value.kind === "fact-enrichment"
    ? "context.indexer.fragment.fact-enrichment/v1"
    : value.kind === "template-variables"
    ? "context.indexer.fragment.template-variables/v1"
    : "context.indexer.fragment.derived-artifact-proposal/v1";
  if (value.payload.protocol !== expected) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.kind} requires payload protocol ${expected}`,
      path: ["payload", "protocol"],
    });
  }
  const expectedPhase = value.kind === "derived-artifact-proposal"
    ? "post-author"
    : "pre-authority";
  if (value.phase !== expectedPhase) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.kind} is only valid in ${expectedPhase}`,
      path: ["phase"],
    });
  }
  if (value.phase === "post-author" && value.composer_ref === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "post-author fragment requires composer_ref",
      path: ["composer_ref"],
    });
  }
  if (value.phase === "pre-authority" && value.composer_ref !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "pre-authority fragment cannot carry composer_ref",
      path: ["composer_ref"],
    });
  }
});

export type IndexerLayerFragmentPayload = z.infer<
  typeof indexerLayerFragmentPayloadSchema
>;
export type IndexerEvidenceRef = z.infer<typeof indexerEvidenceRefSchema>;
export type IndexerLayerFragment = z.infer<typeof indexerLayerFragmentSchema>;

export function indexerLayerFragmentDigest(
  fragment: Omit<IndexerLayerFragment, "fragment_digest">,
): string {
  return indexerProtocolDigest(fragment);
}

export const indexerMaterializedLayerFragmentSchema = z.object({
  fragment_digest: indexerDigestSchema,
  layer_ref: indexerProviderLayerRefSchema,
  layer_integrity: indexerDigestSchema,
  composer_ref: indexerComposerRefSchema.optional(),
  phase: z.enum(["pre-authority", "post-author"]),
  kind: z.enum(INDEXER_LAYER_FRAGMENT_KINDS),
  target_refs: z.array(indexerCanonicalRefSchema),
  payload: indexerLayerFragmentPayloadSchema,
  payload_digest: indexerDigestSchema,
  materialization_receipt: z.object({
    protocol: z.literal(
      "context.indexer.layer-fragment-materialization-receipt/v1",
    ),
    fragment_digest: indexerDigestSchema,
    payload_digest: indexerDigestSchema,
    layer_ref: indexerProviderLayerRefSchema,
    layer_integrity: indexerDigestSchema,
    composer_ref: indexerComposerRefSchema.optional(),
    validator_contract_digest: indexerDigestSchema,
  }).strict(),
}).strict();

export type IndexerMaterializedLayerFragment = z.infer<
  typeof indexerMaterializedLayerFragmentSchema
>;

export function validateIndexerMaterializedLayerFragment(
  value: unknown,
): IndexerMaterializedLayerFragment {
  const fragment = indexerMaterializedLayerFragmentSchema.parse(value);
  const payloadDigest = indexerProtocolDigest(fragment.payload);
  const receipt = fragment.materialization_receipt;
  if (
    fragment.payload_digest !== payloadDigest ||
    receipt.payload_digest !== payloadDigest ||
    receipt.fragment_digest !== fragment.fragment_digest ||
    receipt.layer_ref !== fragment.layer_ref ||
    receipt.layer_integrity !== fragment.layer_integrity ||
    receipt.composer_ref !== fragment.composer_ref
  ) {
    throw new TypeError("materialized layer fragment receipt is invalid");
  }
  return fragment;
}

export interface IndexerLayerFragmentLimits {
  maximum_items: number;
  maximum_payload_bytes: number;
}

export const DEFAULT_INDEXER_LAYER_FRAGMENT_LIMITS: IndexerLayerFragmentLimits = {
  maximum_items: 512,
  maximum_payload_bytes: 262_144,
};

function withoutField<T extends object, K extends keyof T>(
  value: T,
  field: K,
): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  ) as Omit<T, K>;
}

function fragmentItems(payload: IndexerLayerFragmentPayload): Array<{
  target_ref?: string;
  target_node_ref?: string;
  composer_ref?: string;
  evidence_refs: Array<{ ref: string }>;
}> {
  if (payload.protocol === "context.indexer.fragment.fact-enrichment/v1") {
    return payload.facts;
  }
  if (payload.protocol === "context.indexer.fragment.template-variables/v1") {
    return payload.variables;
  }
  return payload.proposals;
}

function fragmentItemIdentity(
  payload: IndexerLayerFragmentPayload,
  index: number,
): string {
  if (payload.protocol === "context.indexer.fragment.fact-enrichment/v1") {
    const item = payload.facts[index]!;
    return `${item.target_ref}\u0000${item.fact_id}`;
  }
  if (payload.protocol === "context.indexer.fragment.template-variables/v1") {
    const item = payload.variables[index]!;
    return `${item.target_ref}\u0000${item.template_id}\u0000${item.variable_id}`;
  }
  const item = payload.proposals[index]!;
  return `${item.composer_ref}\u0000${item.target_node_ref}\u0000${item.artifact.artifact_kind}\u0000${item.artifact.artifact_id}`;
}

function validateFragmentPayload(
  fragment: IndexerLayerFragment,
  allowedTargets: ReadonlySet<string>,
  limits: IndexerLayerFragmentLimits,
): void {
  if (fragment.target_refs.some((target) => !allowedTargets.has(target))) {
    throw new TypeError("layer fragment contains a target outside the current workset");
  }
  const declaredTargets = new Set(fragment.target_refs);
  const items = fragmentItems(fragment.payload);
  if (items.length > limits.maximum_items) {
    throw new TypeError("layer fragment exceeds the CLI item limit");
  }
  const payloadBytes = Buffer.byteLength(JSON.stringify(fragment.payload), "utf8");
  if (payloadBytes > limits.maximum_payload_bytes) {
    throw new TypeError("layer fragment exceeds the CLI payload byte limit");
  }
  const identities = new Set<string>();
  items.forEach((item, index) => {
    const target = item.target_ref ?? item.target_node_ref;
    if (target === undefined || !declaredTargets.has(target)) {
      throw new TypeError("layer fragment item references an undeclared target");
    }
    if (
      fragment.composer_ref !== undefined &&
      item.composer_ref !== undefined &&
      fragment.composer_ref !== item.composer_ref
    ) {
      throw new TypeError("derived proposal composer does not match its fragment");
    }
    const identity = fragmentItemIdentity(fragment.payload, index);
    if (identities.has(identity)) {
      throw new TypeError(`layer fragment repeats item identity ${identity}`);
    }
    identities.add(identity);
    const evidenceRefs = item.evidence_refs.map((evidence) => evidence.ref);
    if ([...evidenceRefs].sort().some((value, i) => value !== evidenceRefs[i])) {
      throw new TypeError("layer fragment evidence_refs must use canonical ordering");
    }
  });
  if ([...fragment.target_refs].sort().some((value, i) => value !== fragment.target_refs[i])) {
    throw new TypeError("layer fragment target_refs must use canonical ordering");
  }
  const orderedIdentities = [...identities].sort();
  const actualIdentities = items.map((_, index) => fragmentItemIdentity(fragment.payload, index));
  if (orderedIdentities.some((value, index) => value !== actualIdentities[index])) {
    throw new TypeError("layer fragment items must use canonical identity ordering");
  }
}

export function validateAndMaterializeIndexerLayerFragment(input: {
  fragment: unknown;
  expected_workset_digest: string;
  expected_layer_ref: string;
  expected_layer_integrity: string;
  expected_composer_ref?: string;
  allowed_kinds: readonly IndexerLayerFragment["kind"][];
  allowed_target_refs: readonly string[];
  validator_contract_digest: string;
  limits?: IndexerLayerFragmentLimits;
}): IndexerMaterializedLayerFragment {
  const parsed = indexerLayerFragmentSchema.safeParse(input.fragment);
  if (!parsed.success) {
    throw new TypeError(
      `layer fragment is invalid: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  const fragment = parsed.data;
  const payload = withoutField(fragment, "fragment_digest");
  if (indexerLayerFragmentDigest(payload) !== fragment.fragment_digest) {
    throw new TypeError("layer fragment digest does not match its canonical payload");
  }
  if (
    fragment.workset_digest !== input.expected_workset_digest ||
    fragment.layer_ref !== input.expected_layer_ref ||
    fragment.layer_integrity !== input.expected_layer_integrity ||
    fragment.composer_ref !== input.expected_composer_ref
  ) {
    throw new TypeError("layer fragment authority binding does not match its request");
  }
  if (!input.allowed_kinds.includes(fragment.kind)) {
    throw new TypeError(`layer fragment kind ${fragment.kind} was not authorized`);
  }
  validateFragmentPayload(
    fragment,
    new Set(input.allowed_target_refs),
    input.limits ?? DEFAULT_INDEXER_LAYER_FRAGMENT_LIMITS,
  );
  const payloadDigest = indexerProtocolDigest(fragment.payload);
  return indexerMaterializedLayerFragmentSchema.parse({
    fragment_digest: fragment.fragment_digest,
    layer_ref: fragment.layer_ref,
    layer_integrity: fragment.layer_integrity,
    composer_ref: fragment.composer_ref,
    phase: fragment.phase,
    kind: fragment.kind,
    target_refs: fragment.target_refs,
    payload: fragment.payload,
    payload_digest: payloadDigest,
    materialization_receipt: {
      protocol: "context.indexer.layer-fragment-materialization-receipt/v1",
      fragment_digest: fragment.fragment_digest,
      payload_digest: payloadDigest,
      layer_ref: fragment.layer_ref,
      layer_integrity: fragment.layer_integrity,
      composer_ref: fragment.composer_ref,
      validator_contract_digest: input.validator_contract_digest,
    },
  });
}

const diagnosticSchema = z.object({
  code: indexerIdSchema,
  message: z.string().min(1),
  fragment_digest: indexerDigestSchema.optional(),
}).strict();

export const indexerLayerCompositionInputSchema = z.object({
  protocol: z.literal("context.indexer.layer-composition-input/v1"),
  workset_digest: indexerDigestSchema,
  final_authority_layer_ref: indexerProviderLayerRefSchema,
  accepted_fragments: z.array(indexerMaterializedLayerFragmentSchema),
  rejected_fragment_diagnostics: z.array(diagnosticSchema),
  view_digest: indexerDigestSchema,
}).strict();

export type IndexerLayerCompositionInput = z.infer<
  typeof indexerLayerCompositionInputSchema
>;

export function indexerLayerCompositionInputDigest(
  view: Omit<IndexerLayerCompositionInput, "view_digest">,
): string {
  return indexerProtocolDigest(view);
}

function materializedFragmentConflictKeys(
  fragment: IndexerMaterializedLayerFragment,
): string[] {
  if (fragment.payload.protocol === "context.indexer.fragment.fact-enrichment/v1") {
    return fragment.payload.facts.map((item) => `fact:${item.target_ref}:${item.fact_id}`);
  }
  if (fragment.payload.protocol === "context.indexer.fragment.template-variables/v1") {
    return fragment.payload.variables.map((item) =>
      `variable:${item.target_ref}:${item.template_id}:${item.variable_id}`
    );
  }
  return fragment.payload.proposals.map((item) =>
    `artifact:${item.target_node_ref}:${item.artifact.artifact_kind}:${item.artifact.artifact_id}`
  );
}

export function composeIndexerLayerInput(input: {
  workset_digest: string;
  final_authority_layer_ref: string;
  fragments: readonly IndexerMaterializedLayerFragment[];
}): IndexerLayerCompositionInput {
  const fragments = input.fragments.map((item) =>
    validateIndexerMaterializedLayerFragment(item)
  ).sort((left, right) =>
    compareIndexerCanonicalText(
      `${left.layer_ref}\u0000${left.fragment_digest}`,
      `${right.layer_ref}\u0000${right.fragment_digest}`,
    )
  );
  const conflicts = new Map<string, string>();
  for (const fragment of fragments) {
    if (fragment.phase !== "pre-authority" || fragment.composer_ref !== undefined) {
      throw new TypeError("primary composition input accepts only pre-authority fragments");
    }
    if (fragment.materialization_receipt.composer_ref !== undefined) {
      throw new TypeError("pre-authority materialization receipt cannot bind a composer");
    }
    for (const key of materializedFragmentConflictKeys(fragment)) {
      const prior = conflicts.get(key);
      if (prior !== undefined) {
        throw new TypeError(
          `layer fragments ${prior} and ${fragment.fragment_digest} conflict on ${key}`,
        );
      }
      conflicts.set(key, fragment.fragment_digest);
    }
  }
  const payload: Omit<IndexerLayerCompositionInput, "view_digest"> = {
    protocol: "context.indexer.layer-composition-input/v1",
    workset_digest: input.workset_digest,
    final_authority_layer_ref: input.final_authority_layer_ref,
    accepted_fragments: fragments,
    rejected_fragment_diagnostics: [],
  };
  return indexerLayerCompositionInputSchema.parse({
    ...payload,
    view_digest: indexerLayerCompositionInputDigest(payload),
  });
}

export function validateIndexerLayerCompositionInput(
  value: unknown,
): IndexerLayerCompositionInput {
  const parsed = indexerLayerCompositionInputSchema.parse(value);
  const payload = withoutField(parsed, "view_digest");
  if (indexerLayerCompositionInputDigest(payload) !== parsed.view_digest) {
    throw new TypeError("layer composition input digest is invalid");
  }
  composeIndexerLayerInput({
    workset_digest: parsed.workset_digest,
    final_authority_layer_ref: parsed.final_authority_layer_ref,
    fragments: parsed.accepted_fragments,
  });
  return parsed;
}
