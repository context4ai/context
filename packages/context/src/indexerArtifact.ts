import { z } from "zod";
import {
  indexerArtifactContentBlockSchema,
  indexerCanonicalJsonSchema,
} from "./indexerContentLayers.js";
import {
  indexerCanonicalRefSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

export const indexerArtifactSectionProjectionSchema = z.object({
  section_key: indexerIdSchema,
  owner_indexer_id: indexerIdSchema,
  document_kind: indexerIdSchema,
  reader_goal: indexerIdSchema,
  artifact_kind: indexerIdSchema,
}).strict();

const indexerArtifactSectionSchema = indexerArtifactSectionProjectionSchema.extend({
  blocks: z.array(indexerArtifactContentBlockSchema).min(1),
}).strict();

const indexerArtifactTemplateVariableSchema = z.object({
  value: indexerCanonicalJsonSchema,
  fact_refs: z.array(indexerCanonicalRefSchema),
  evidence_refs: z.array(indexerCanonicalRefSchema),
}).strict();

const artifactCommonFields = {
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  artifact_policy_variant: indexerIdSchema,
};

const indexerTemplateArtifactSchema = z.object({
  ...artifactCommonFields,
  representation: z.literal("template"),
  template_id: indexerIdSchema,
  variables: z.record(indexerArtifactTemplateVariableSchema),
  section_projections: z.array(indexerArtifactSectionProjectionSchema).min(1),
}).strict();

const indexerSectionArtifactSchema = z.object({
  ...artifactCommonFields,
  representation: z.literal("sections"),
  sections: z.array(indexerArtifactSectionSchema).min(1),
}).strict();

export const indexerArtifactSchema = z.discriminatedUnion("representation", [
  indexerTemplateArtifactSchema,
  indexerSectionArtifactSchema,
]);

export type IndexerArtifact = z.infer<typeof indexerArtifactSchema>;
export type IndexerArtifactSectionProjection = z.infer<
  typeof indexerArtifactSectionProjectionSchema
>;

export function indexerArtifactRef(
  nodeRef: string,
  artifact: { artifact_id: string; artifact_kind: string },
): string {
  return `artifact:subject:${indexerProtocolDigest({
    protocol: "context.indexer.artifact-identity/v1",
    node_ref: nodeRef,
    artifact_id: artifact.artifact_id,
    artifact_kind: artifact.artifact_kind,
  })}`;
}
