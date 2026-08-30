import { z } from "zod";
import { KNOWLEDGE_COLLECTIONS, type KnowledgeCollection } from "./contracts.js";
import {
  indexerArtifactSectionProjectionSchema,
  type IndexerArtifactSectionProjection,
} from "./indexerArtifactResult.js";
import { validateIndexerProfileContract } from "./indexerProfileContract.js";
import {
  canonicalIndexerJson,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

export const indexerKnowledgeCollectionSchema = z.custom<KnowledgeCollection>(
  (value) => typeof value === "string" &&
    (KNOWLEDGE_COLLECTIONS as readonly string[]).includes(value),
  { message: "collection must be a registered package/query collection" },
);

const sectionCollectionPayloadSchema = z.object({
  protocol: z.literal("context.indexer.section-collection/v1"),
  profile: indexerIdSchema,
  source_role: indexerIdSchema,
  projection: indexerArtifactSectionProjectionSchema,
  collection: indexerKnowledgeCollectionSchema,
  profile_contract_digest: indexerDigestSchema,
  mapping_digest: indexerDigestSchema,
}).strict();

export const indexerSectionCollectionSchema = sectionCollectionPayloadSchema.extend({
  resolution_digest: indexerDigestSchema,
}).strict();

export type IndexerSectionCollection = z.infer<typeof indexerSectionCollectionSchema>;

export function resolveIndexerSectionCollection(input: {
  profile: string;
  source_role: string;
  projection: IndexerArtifactSectionProjection;
  profile_contract: unknown;
  operator_contract: unknown;
}): IndexerSectionCollection {
  const contract = validateIndexerProfileContract(
    input.profile_contract,
    input.operator_contract,
  );
  const profile = contract.profiles.find((item) => item.id === input.profile);
  if (profile === undefined) throw new TypeError(`unknown layout profile ${input.profile}`);
  const projection = indexerArtifactSectionProjectionSchema.parse(input.projection);
  const matches = profile.layout_mappings.filter((mapping) =>
    mapping.source_roles.includes(input.source_role) &&
    mapping.document_kind === projection.document_kind &&
    mapping.reader_goal === projection.reader_goal &&
    mapping.artifact_kinds.includes(projection.artifact_kind)
  );
  if (matches.length !== 1) {
    throw new TypeError(
      `Section ${projection.section_key} must resolve to exactly one CLI collection mapping`,
    );
  }
  const mapping = matches[0]!;
  const payload = sectionCollectionPayloadSchema.parse({
    protocol: "context.indexer.section-collection/v1",
    profile: profile.id,
    source_role: input.source_role,
    projection,
    collection: mapping.collection,
    profile_contract_digest: contract.contract_digest,
    mapping_digest: indexerProtocolDigest(mapping),
  });
  return indexerSectionCollectionSchema.parse({
    ...payload,
    resolution_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerSectionCollection(input: {
  value: unknown;
  profile_contract: unknown;
  operator_contract: unknown;
}): IndexerSectionCollection {
  const value = indexerSectionCollectionSchema.parse(input.value);
  const expected = resolveIndexerSectionCollection({
    profile: value.profile,
    source_role: value.source_role,
    projection: value.projection,
    profile_contract: input.profile_contract,
    operator_contract: input.operator_contract,
  });
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(value)) {
    throw new TypeError("Section collection resolution is stale or forged");
  }
  return value;
}
