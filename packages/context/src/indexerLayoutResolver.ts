import { z } from "zod";
import type { KnowledgeCollection } from "./contracts.js";
import { validateIndexerArtifactBundle } from "./indexerArtifactPolicy.js";
import {
  indexerArtifactResultDigest,
  indexerArtifactResultSchema,
  type IndexerArtifactResult,
  type IndexerArtifactSectionProjection,
} from "./indexerArtifactResult.js";
import { indexerArtifactRef } from "./indexerArtifact.js";
import { materializeIndexerEffectiveArtifactSet } from "./indexerPostAuthorComposition.js";
import { materializeIndexerStructuredContent } from "./indexerContentLayers.js";
import {
  indexerKnowledgeCollectionSchema,
  resolveIndexerSectionCollection,
} from "./indexerCollectionMapping.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import { validateIndexerProfileContract } from "./indexerProfileContract.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";
import {
  validateIndexerResolvedSubjectKeySchemaSet,
  validateIndexerSubjectKeyForSchema,
} from "./indexerSubjectKeyAuthority.js";
import {
  validateIndexerRenderedArtifact,
  type IndexerRenderedArtifact,
} from "./indexerTemplateRendering.js";
import {
  canonicalIndexerNodeRef,
  indexerSubjectKeySchema,
  type IndexerSubjectKey,
} from "./indexerSubjectIdentity.js";
import {
  indexerSharedArtifactFingerprintSchema,
  validateIndexerSharedArtifactFingerprint,
} from "./indexerSharedArtifactFingerprint.js";

const layoutSectionSchema = z.object({
  section_ref: indexerCanonicalRefSchema,
  section_identity_ref: indexerCanonicalRefSchema,
  section_key: indexerIdSchema,
  owner_indexer_id: indexerIdSchema,
  document_kind: indexerIdSchema,
  reader_goal: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  state: z.enum(["structured", "rendered", "material-gap"]),
  content_digest: indexerDigestSchema.nullable(),
  evidence_refs: z.array(indexerCanonicalRefSchema),
  material_question_proposal_ref: indexerCanonicalRefSchema.nullable(),
  collection_resolution_digest: indexerDigestSchema,
}).strict();

const layoutArtifactSchema = z.object({
  artifact_ref: indexerCanonicalRefSchema,
  node_ref: indexerCanonicalRefSchema,
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  internal_view_ref: indexerCanonicalRefSchema,
  collection: indexerKnowledgeCollectionSchema,
  output_path: portableIndexerPathSchema,
  shared_artifact_fingerprint_digest: indexerDigestSchema,
  purpose: z.enum(["required", "discretionary", "semantic-split"]),
  split_of_artifact_ref: indexerCanonicalRefSchema.nullable(),
  split_boundary: z.object({
    axis: indexerIdSchema,
    start_key: z.string().min(1),
    end_key: z.string().min(1),
  }).strict().nullable(),
  sections: z.array(layoutSectionSchema).min(1),
}).strict();

const layoutProposalPayloadSchema = z.object({
  protocol: z.literal("context.indexer.layout-proposal/v1"),
  indexer_id: indexerIdSchema,
  source_ref: indexerCanonicalRefSchema,
  profile: indexerIdSchema,
  profile_contract_digest: indexerDigestSchema,
  subject_key_schema_set_digest: indexerDigestSchema,
  subject_key_schema_digest: indexerDigestSchema,
  artifact_result_digest: indexerDigestSchema,
  post_author_composition_fingerprint: indexerDigestSchema.nullable(),
  shared_artifact_fingerprint: indexerSharedArtifactFingerprintSchema,
  node: z.object({
    node_ref: indexerCanonicalRefSchema,
    subject_key: indexerSubjectKeySchema,
  }).strict(),
  artifacts: z.array(layoutArtifactSchema),
}).strict();

export const indexerLayoutProposalSchema = layoutProposalPayloadSchema.extend({
  proposal_digest: indexerDigestSchema,
}).strict();

export type IndexerLayoutProposal = z.infer<typeof indexerLayoutProposalSchema>;

function withoutOutputDigest(
  result: IndexerArtifactResult,
): Omit<IndexerArtifactResult, "output_digest"> {
  const { output_digest: _digest, ...payload } = result;
  void _digest;
  return payload;
}

function validateArtifactResultIdentity(value: unknown): IndexerArtifactResult {
  const result = indexerArtifactResultSchema.parse(value);
  if (indexerArtifactResultDigest(withoutOutputDigest(result)) !== result.output_digest) {
    throw new TypeError("layout resolver requires a current Artifact Result digest");
  }
  if (canonicalIndexerNodeRef(result.logical_unit.subject_key) !== result.logical_unit.logical_unit_ref) {
    throw new TypeError("layout resolver requires canonical logical-unit Node identity");
  }
  return result;
}

export function indexerLayoutArtifactRef(
  nodeRef: string,
  artifact: { artifact_id: string; artifact_kind: string },
): string {
  return indexerArtifactRef(nodeRef, artifact);
}

export function indexerLayoutSectionIdentityRef(input: {
  node_ref: string;
  owner_indexer_id: string;
  artifact_kind: string;
  section_key: string;
}): string {
  return `section-identity:subject:${indexerProtocolDigest({
    protocol: "context.indexer.section-identity/v1",
    node_ref: input.node_ref,
    owner_indexer_id: input.owner_indexer_id,
    artifact_kind: input.artifact_kind,
    section_key: input.section_key,
  })}`;
}

export function indexerLayoutSectionRef(
  currentArtifactRef: string,
  sectionIdentityRef: string,
): string {
  return `section:subject:${indexerProtocolDigest({
    protocol: "context.indexer.section-placement/v1",
    artifact_ref: currentArtifactRef,
    section_identity_ref: sectionIdentityRef,
  })}`;
}

function viewRef(currentArtifactRef: string, collection: KnowledgeCollection): string {
  return `view:artifact:${indexerProtocolDigest({
    protocol: "context.indexer.internal-view-identity/v1",
    artifact_ref: currentArtifactRef,
    collection,
  })}`;
}

function readerPathSlug(value: string): string {
  const identity = value.trim();
  if (
    /^(?:artifact|evidence|node|section|view):/iu.test(identity) ||
    /(?:^|[:/_-])sha256(?::|$)/iu.test(identity) ||
    /^[a-f\d]{32,}$/iu.test(identity) ||
    /^\d{8,14}$/u.test(identity) ||
    /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(identity)
  ) {
    throw new TypeError("layout resolver rejects machine identity in a reader-facing path");
  }
  const slug = value
    .normalize("NFC")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1-$2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1-$2")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (slug.length === 0) {
    throw new TypeError("layout resolver requires a reader-readable semantic path identity");
  }
  return slug;
}

function outputPath(input: {
  collection: KnowledgeCollection;
  subject_key: IndexerSubjectKey;
  artifact: { artifact_id: string; artifact_kind: string };
  primary: boolean;
  duplicate_kind: boolean;
}): string {
  const namespace = readerPathSlug(input.subject_key.namespace);
  const subject = readerPathSlug(input.subject_key.local_key);
  const suffix = input.primary
    ? ""
    : input.duplicate_kind
      ? `-${readerPathSlug(input.artifact.artifact_kind)}-${readerPathSlug(
          input.artifact.artifact_id,
        )}`
      : `-${readerPathSlug(input.artifact.artifact_kind)}`;
  return `knowledge/${input.collection}/${namespace}/${subject}${suffix}.md`;
}

interface MaterializedSection {
  projection: IndexerArtifactSectionProjection;
  state: "structured" | "rendered" | "material-gap";
  content_digest: string | null;
  evidence_refs: string[];
  material_question_proposal_ref: string | null;
}

function structuredSections(
  artifact: Extract<IndexerArtifactResult["artifacts"][number], { representation: "sections" }>,
  facts: IndexerArtifactResult["facts"],
): MaterializedSection[] {
  return artifact.sections.map((section) => {
    const contentBlocks = materializeIndexerStructuredContent({
      blocks: section.blocks,
      facts,
    });
    const evidenceRefs = [...new Set(contentBlocks.flatMap((block) => block.evidence_refs))]
      .sort(compareIndexerCanonicalText);
    return {
      projection: {
        section_key: section.section_key,
        owner_indexer_id: section.owner_indexer_id,
        document_kind: section.document_kind,
        reader_goal: section.reader_goal,
        artifact_kind: section.artifact_kind,
      },
      state: "structured",
      content_digest: indexerProtocolDigest({ content_blocks: contentBlocks }),
      evidence_refs: evidenceRefs,
      material_question_proposal_ref: null,
    };
  });
}

function templateSections(input: {
  result: IndexerArtifactResult;
  artifact: Extract<IndexerArtifactResult["artifacts"][number], { representation: "template" }>;
  rendered: IndexerRenderedArtifact;
  profile: string;
}): MaterializedSection[] {
  const rendered = validateIndexerRenderedArtifact(input.rendered);
  if (
    rendered.artifact_result_digest !== input.result.output_digest ||
    rendered.artifact_id !== input.artifact.artifact_id ||
    rendered.artifact_kind !== input.artifact.artifact_kind ||
    rendered.artifact_policy_variant !== input.artifact.artifact_policy_variant ||
    rendered.template_id !== input.artifact.template_id ||
    rendered.profile !== input.profile
  ) {
    throw new TypeError(`rendered Artifact ${rendered.artifact_id} is stale for layout`);
  }
  const projections = new Map(input.artifact.section_projections.map((projection) => [
    projection.section_key,
    projection,
  ]));
  const sections: MaterializedSection[] = rendered.sections.map((section) => {
    const projection = projections.get(section.section_key);
    if (projection === undefined) {
      throw new TypeError(`rendered Section ${section.section_key} lacks projection intent`);
    }
    if (
      section.owner_indexer_id !== projection.owner_indexer_id ||
      section.document_kind !== projection.document_kind ||
      section.reader_goal !== projection.reader_goal ||
      section.artifact_kind !== projection.artifact_kind
    ) {
      throw new TypeError(`rendered Section ${section.section_key} changes projection intent`);
    }
    return {
      projection,
      state: "rendered",
      content_digest: section.content_digest,
      evidence_refs: [...section.evidence_refs],
      material_question_proposal_ref: null,
    };
  });
  for (const gap of rendered.material_question_gaps) {
    const projection = projections.get(gap.section_key);
    if (projection === undefined) {
      throw new TypeError(`material-gap Section ${gap.section_key} lacks projection intent`);
    }
    sections.push({
      projection,
      state: "material-gap",
      content_digest: null,
      evidence_refs: [],
      material_question_proposal_ref: gap.material_question_proposal_ref,
    });
  }
  return sections.sort((left, right) => compareIndexerCanonicalText(
    left.projection.section_key,
    right.projection.section_key,
  ));
}

export function resolveIndexerLayout(input: {
  artifact_result: unknown;
  post_author_envelope?: unknown | null;
  profile: string;
  profile_contract: unknown;
  operator_contract: unknown;
  subject_key_schema_set: unknown;
  shared_artifact_fingerprint: unknown;
  rendered_artifacts?: readonly IndexerRenderedArtifact[];
}): IndexerLayoutProposal {
  const result = validateArtifactResultIdentity(input.artifact_result);
  const effective = materializeIndexerEffectiveArtifactSet({
    artifact_result: result,
    post_author_envelope: input.post_author_envelope,
  });
  const sharedFingerprint = validateIndexerSharedArtifactFingerprint(
    input.shared_artifact_fingerprint,
  );
  if (sharedFingerprint.indexer_id !== result.indexer_id) {
    throw new TypeError("layout resolver shared Artifact fingerprint has the wrong Indexer");
  }
  const contract = validateIndexerProfileContract(input.profile_contract, input.operator_contract);
  const subjectKeySchemaSet = validateIndexerResolvedSubjectKeySchemaSet(
    input.subject_key_schema_set,
  );
  const subjectKeySchema = subjectKeySchemaSet.schemas.find((schema) =>
    schema.indexer_id === result.indexer_id && schema.profile === input.profile
  );
  if (subjectKeySchema === undefined) {
    throw new TypeError("layout resolver requires an exact Indexer/profile SubjectKey schema");
  }
  validateIndexerSubjectKeyForSchema(result.logical_unit.subject_key, subjectKeySchema);
  const renderedById = new Map((input.rendered_artifacts ?? []).map((item) => [
    item.artifact_id,
    item,
  ]));
  if (renderedById.size !== (input.rendered_artifacts ?? []).length) {
    throw new TypeError("layout resolver received duplicate rendered Artifacts");
  }
  const usedRendered = new Set<string>();
  const nodeRef = result.logical_unit.logical_unit_ref;
  if (effective.artifacts.length > 0 && effective.artifact_bundle === null) {
    throw new TypeError("layout resolver requires a closed Artifact Bundle");
  }
  if (effective.artifacts.length === 0 && effective.artifact_bundle !== null) {
    throw new TypeError("layout resolver rejects an Artifact Bundle without Artifacts");
  }
  const artifactBundle = effective.artifact_bundle === null
    ? null
    : validateIndexerArtifactBundle(effective.artifact_bundle);
  if (artifactBundle !== null && artifactBundle.logical_unit_ref !== nodeRef) {
    throw new TypeError("layout resolver requires an Artifact Bundle for the current Node");
  }
  const bundleById = new Map((artifactBundle?.artifacts ?? []).map((artifact) => [
    artifact.artifact_id,
    artifact,
  ]));
  if (
    bundleById.size !== (artifactBundle?.artifacts.length ?? 0) ||
    bundleById.size !== effective.artifacts.length
  ) {
    throw new TypeError("layout resolver requires one Artifact Bundle entry per Artifact");
  }
  const requiredArtifactIds = new Set((artifactBundle?.artifacts ?? [])
    .filter((artifact) => artifact.purpose === "required")
    .map((artifact) => artifact.artifact_id));
  const artifactKindCounts = new Map<string, number>();
  for (const artifact of effective.artifacts) {
    artifactKindCounts.set(
      artifact.artifact_kind,
      (artifactKindCounts.get(artifact.artifact_kind) ?? 0) + 1,
    );
  }
  const artifacts = effective.artifacts.map((artifact) => {
    const bundleEntry = bundleById.get(artifact.artifact_id);
    if (bundleEntry === undefined || bundleEntry.artifact_kind !== artifact.artifact_kind) {
      throw new TypeError(`Artifact ${artifact.artifact_id} is absent from its closed Bundle`);
    }
    const sections = artifact.representation === "sections"
      ? structuredSections(artifact, result.facts)
      : (() => {
        const rendered = renderedById.get(artifact.artifact_id);
        if (rendered === undefined) {
          throw new TypeError(`template Artifact ${artifact.artifact_id} must be rendered before layout`);
        }
        usedRendered.add(artifact.artifact_id);
        return templateSections({ result, artifact, rendered, profile: input.profile });
      })();
    if (sections.length === 0) {
      throw new TypeError(`Artifact ${artifact.artifact_id} has no actual or material-gap Section`);
    }
    const resolved = sections.map((section) => resolveIndexerSectionCollection({
      profile: input.profile,
      source_role: result.source_role,
      projection: section.projection,
      profile_contract: contract,
      operator_contract: input.operator_contract,
    }));
    const collections = new Set(resolved.map((item) => item.collection));
    if (collections.size !== 1) {
      throw new TypeError(`Artifact ${artifact.artifact_id} maps Sections to multiple collections`);
    }
    const collection = resolved[0]!.collection;
    const currentArtifactRef = indexerLayoutArtifactRef(nodeRef, artifact);
    const splitOfArtifactRef = bundleEntry.purpose === "semantic-split"
      ? (() => {
        const parent = bundleById.get(bundleEntry.split_of);
        if (parent === undefined) {
          throw new TypeError(`semantic split ${artifact.artifact_id} has no current parent`);
        }
        return indexerLayoutArtifactRef(nodeRef, parent);
      })()
      : null;
    return {
      artifact_ref: currentArtifactRef,
      node_ref: nodeRef,
      artifact_id: artifact.artifact_id,
      artifact_kind: artifact.artifact_kind,
      internal_view_ref: viewRef(currentArtifactRef, collection),
      collection,
      output_path: outputPath({
        collection,
        subject_key: result.logical_unit.subject_key,
        artifact,
        primary: effective.artifacts.length === 1 ||
          (requiredArtifactIds.size === 1 && requiredArtifactIds.has(artifact.artifact_id)),
        duplicate_kind: (artifactKindCounts.get(artifact.artifact_kind) ?? 0) > 1,
      }),
      shared_artifact_fingerprint_digest: sharedFingerprint.fingerprint_digest,
      purpose: bundleEntry.purpose,
      split_of_artifact_ref: splitOfArtifactRef,
      split_boundary: bundleEntry.purpose === "semantic-split"
        ? bundleEntry.boundary
        : null,
      sections: sections.map((section, index) => {
        const sectionIdentityRef = indexerLayoutSectionIdentityRef({
          node_ref: nodeRef,
          owner_indexer_id: section.projection.owner_indexer_id,
          artifact_kind: section.projection.artifact_kind,
          section_key: section.projection.section_key,
        });
        return {
          section_ref: indexerLayoutSectionRef(currentArtifactRef, sectionIdentityRef),
          section_identity_ref: sectionIdentityRef,
          ...section.projection,
          state: section.state,
          content_digest: section.content_digest,
          evidence_refs: section.evidence_refs,
          material_question_proposal_ref: section.material_question_proposal_ref,
          collection_resolution_digest: resolved[index]!.resolution_digest,
        };
      }),
    };
  }).sort((left, right) => compareIndexerCanonicalText(left.artifact_ref, right.artifact_ref));
  if (usedRendered.size !== renderedById.size) {
    throw new TypeError("layout resolver received an unrelated rendered Artifact");
  }
  if (new Set(artifacts.map((artifact) => artifact.output_path)).size !== artifacts.length) {
    throw new TypeError("layout resolver produced colliding output paths");
  }
  const sectionIdentities = artifacts.flatMap((artifact) =>
    artifact.sections.map((section) => section.section_identity_ref)
  );
  if (new Set(sectionIdentities).size !== sectionIdentities.length) {
    throw new TypeError("layout resolver produced colliding logical Section identities");
  }
  const payload = layoutProposalPayloadSchema.parse({
    protocol: "context.indexer.layout-proposal/v1",
    indexer_id: result.indexer_id,
    source_ref: result.source_ref,
    profile: input.profile,
    profile_contract_digest: contract.contract_digest,
    subject_key_schema_set_digest: subjectKeySchemaSet.set_digest,
    subject_key_schema_digest: subjectKeySchema.schema_digest,
    artifact_result_digest: result.output_digest,
    post_author_composition_fingerprint: effective.composition_fingerprint,
    shared_artifact_fingerprint: sharedFingerprint,
    node: {
      node_ref: nodeRef,
      subject_key: result.logical_unit.subject_key,
    },
    artifacts,
  });
  return indexerLayoutProposalSchema.parse({
    ...payload,
    proposal_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerLayoutProposal(input: {
  proposal: unknown;
  artifact_result: unknown;
  post_author_envelope?: unknown | null;
  profile_contract: unknown;
  operator_contract: unknown;
  subject_key_schema_set: unknown;
  rendered_artifacts?: readonly IndexerRenderedArtifact[];
}): IndexerLayoutProposal {
  const proposal = indexerLayoutProposalSchema.parse(input.proposal);
  const expected = resolveIndexerLayout({
    artifact_result: input.artifact_result,
    post_author_envelope: input.post_author_envelope,
    profile: proposal.profile,
    profile_contract: input.profile_contract,
    operator_contract: input.operator_contract,
    subject_key_schema_set: input.subject_key_schema_set,
    shared_artifact_fingerprint: proposal.shared_artifact_fingerprint,
    ...(input.rendered_artifacts === undefined
      ? {}
      : { rendered_artifacts: input.rendered_artifacts }),
  });
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(proposal)) {
    throw new TypeError("layout proposal is stale or forged");
  }
  return proposal;
}
