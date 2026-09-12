import { z } from "zod";
import { articleSourceReferenceSchema } from "./articleStructure.js";
import {
  indexerArtifactContentBlockSchema,
  indexerCanonicalJsonSchema,
} from "./indexerContentLayers.js";
import {
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
  references: z.array(articleSourceReferenceSchema).max(3),
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
  template_id: indexerIdSchema.optional(),
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
  logicalUnitRef: string,
  artifact: { artifact_id: string; artifact_kind?: string },
): string {
  return `article:${indexerProtocolDigest({
    protocol: "context.indexer.artifact-identity/v1",
    logical_unit_ref: logicalUnitRef,
    artifact_id: artifact.artifact_id,
  })}`;
}

/** Article-wide traversal has no three-source cap; that cap applies to each
 * individual fragment. This helper never expands references into parser facts. */
export function indexerArtifactReferences(artifact: IndexerArtifact) {
  return artifact.representation === "sections"
    ? artifact.sections.flatMap(section => section.blocks.flatMap(block => block.references))
    : Object.values(artifact.variables).flatMap(variable => variable.references);
}
