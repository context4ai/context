import { z } from "zod";
import { indexerArtifactRef } from "./indexerArtifact.js";
import {
  indexerArtifactResultDigest,
  indexerArtifactResultSchema,
  type IndexerArtifactResult,
} from "./indexerArtifactResult.js";
import {
  compareIndexerCanonicalText,
  indexerCanonicalRefSchema,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
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

const primaryArtifactSchema = z.object({
  artifact_ref: indexerCanonicalRefSchema,
  artifact_kind: indexerIdSchema,
  artifact_policy_variant: indexerIdSchema,
  variables: z.record(canonicalJsonSchema),
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
  artifacts: z.array(primaryArtifactSchema),
  view_digest: indexerDigestSchema,
  materialization_receipt: primaryResultViewReceiptSchema,
}).strict();

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

export function materializeIndexerPrimaryResultView(input: {
  workset_digest: string;
  primary_result_digest: string;
  artifacts: readonly IndexerPrimaryArtifactView[];
  validator_contract_digest: string;
}): IndexerPrimaryResultView {
  const artifacts = input.artifacts.map((item) => primaryArtifactSchema.parse(item))
    .sort((left, right) =>
      compareIndexerCanonicalText(left.artifact_ref, right.artifact_ref)
    );
  if (new Set(artifacts.map((item) => item.artifact_ref)).size !== artifacts.length) {
    throw new TypeError("PrimaryResultView artifact_ref values must be unique");
  }
  const content: PrimaryResultViewContent = {
    protocol: "context.indexer.primary-result-view/v1",
    workset_digest: input.workset_digest,
    primary_result_digest: input.primary_result_digest,
    primary_result_protocol: "context.indexer.main-result/v1",
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

export function validateIndexerPrimaryArtifactResult(value: unknown): IndexerArtifactResult {
  const result = indexerArtifactResultSchema.parse(value);
  const { output_digest: _outputDigest, ...payload } = result;
  void _outputDigest;
  if (indexerArtifactResultDigest(payload) !== result.output_digest) {
    throw new TypeError("PrimaryResultView requires an intact accepted ArtifactResult");
  }
  return result;
}

export function materializeIndexerPrimaryResultViewFromArtifactResult(input: {
  artifact_result: unknown;
  primary_result_digest: string;
  validator_contract_digest: string;
}): IndexerPrimaryResultView {
  const result = validateIndexerPrimaryArtifactResult(input.artifact_result);
  const artifacts = result.artifacts.map((artifact) => ({
    artifact_ref: indexerArtifactRef(result.logical_unit.logical_unit_ref, artifact),
    artifact_kind: artifact.artifact_kind,
    artifact_policy_variant: artifact.artifact_policy_variant,
    variables: artifact.representation === "template"
      ? {
          representation: artifact.representation,
          template_id: artifact.template_id,
          variables: artifact.variables,
          section_projections: artifact.section_projections,
        }
      : {
          representation: artifact.representation,
          sections: artifact.sections,
        },
  }));
  return materializeIndexerPrimaryResultView({
    workset_digest: result.author_workset_digest,
    primary_result_digest: input.primary_result_digest,
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
    artifacts: view.artifacts,
    validator_contract_digest: receipt.validator_contract_digest,
  });
  if (rebuilt.view_digest !== view.view_digest) {
    throw new TypeError("PrimaryResultView payload does not use canonical ordering");
  }
  return view;
}
