import { z } from "zod";
import { indexerArtifactRef, type IndexerArtifact } from "./indexerArtifact.js";
import {
  indexerArtifactResultDigest,
  indexerArtifactResultSchema,
  type IndexerArtifactResult,
} from "./indexerArtifactResult.js";
import { indexerEvidenceRefSchema } from "./indexerLayerComposition.js";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  indexerCanonicalRefSchema,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import type { IndexerJson } from "./indexerRegistry.js";
import { indexerSubjectKeySchema } from "./indexerSubjectIdentity.js";

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

function artifactEvidenceRefs(
  artifact: IndexerArtifact,
  facts: ReadonlyMap<string, IndexerArtifactResult["facts"][number]>,
): string[] {
  const refs = artifact.representation === "sections"
    ? artifact.sections.flatMap((section) => section.blocks.flatMap((block) =>
        block.layer === "semantic-prose"
          ? block.evidence_refs
          : block.fact_refs.flatMap((factRef) => facts.get(factRef)?.evidence_refs ?? [])
      ))
    : Object.values(artifact.variables).flatMap((variable) => [
        ...variable.evidence_refs,
        ...variable.fact_refs.flatMap((factRef) => facts.get(factRef)?.evidence_refs ?? []),
      ]);
  return [...new Set(refs)].sort(compareIndexerCanonicalText);
}

export function validateIndexerPrimaryArtifactResult(value: unknown): IndexerArtifactResult {
  const result = indexerArtifactResultSchema.parse(value);
  const { output_digest: _outputDigest, ...payload } = result;
  void _outputDigest;
  if (indexerArtifactResultDigest(payload) !== result.output_digest) {
    throw new TypeError("PrimaryResultView requires an intact accepted ArtifactResult");
  }
  return result;
}

function evidenceViews(input: {
  refs: readonly string[];
  byRef: ReadonlyMap<string, IndexerArtifactResult["evidence_bindings"][number]>;
}) {
  return input.refs.map((ref) => {
    const binding = input.byRef.get(ref);
    if (binding === undefined) {
      throw new TypeError(`PrimaryResultView references unknown evidence ${ref}`);
    }
    return {
      ref: binding.evidence_ref,
      kind: binding.kind,
      source_digest: binding.content_digest,
    };
  }).sort((left, right) => compareIndexerCanonicalText(left.ref, right.ref));
}

export function materializeIndexerPrimaryResultViewFromArtifactResult(input: {
  artifact_result: unknown;
  primary_result_digest: string;
  validator_contract_digest: string;
}): IndexerPrimaryResultView {
  const result = validateIndexerPrimaryArtifactResult(input.artifact_result);
  const evidenceByRef = new Map(result.evidence_bindings.map((binding) => [
    binding.evidence_ref,
    binding,
  ]));
  const facts = result.facts.map((fact) => ({
    fact_ref: fact.fact_ref,
    subject_key: fact.subject_key,
    fact_kind: fact.fact_kind,
    value: fact.value,
    evidence_refs: evidenceViews({ refs: fact.evidence_refs, byRef: evidenceByRef }),
  }));
  const factByRef = new Map(result.facts.map((fact) => [fact.fact_ref, fact]));
  const artifacts = result.artifacts.map((artifact) => ({
    artifact_ref: indexerArtifactRef(result.logical_unit.logical_unit_ref, artifact),
    subject_key: result.logical_unit.subject_key,
    artifact_kind: artifact.artifact_kind,
    artifact_policy_variant: artifact.artifact_policy_variant,
    variables: artifact.representation === "template"
      ? {
          representation: artifact.representation,
          template_id: artifact.template_id,
          variables: Object.fromEntries(Object.entries(artifact.variables).map(([id, binding]) => [
            id,
            binding.value,
          ])),
          section_projections: artifact.section_projections,
        }
      : {
          representation: artifact.representation,
          sections: artifact.sections,
        },
    evidence_refs: evidenceViews({
      refs: artifactEvidenceRefs(artifact, factByRef),
      byRef: evidenceByRef,
    }),
  }));
  return materializeIndexerPrimaryResultView({
    workset_digest: result.author_workset_digest,
    primary_result_digest: input.primary_result_digest,
    facts,
    artifacts,
    validator_contract_digest: input.validator_contract_digest,
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
