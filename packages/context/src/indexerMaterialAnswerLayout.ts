import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import { validateIndexerLayoutProposalSet } from "./indexerLayoutProposalSet.js";
import { indexerLayoutProposalSchema } from "./indexerLayoutResolver.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

export const indexerMaterialAnswerActualTargetRefSchema = z.string()
  .min(1)
  .refine((value) => /^(node|artifact|section):/.test(value), {
    message: "actualized material-answer target must be a Node, Artifact, or Section ref",
  });

export const indexerMaterialAnswerLandingMappingSchema = z.object({
  answer_landing_ref: indexerCanonicalRefSchema,
  actualized_target_ref: indexerMaterialAnswerActualTargetRefSchema,
  section_ref: z.string().min(1).refine((value) => value.startsWith("section:"), {
    message: "material-answer section_ref must be a Section ref",
  }).optional(),
}).strict();

const layoutProposalPayloadSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-layout-proposal/v1"),
  layout_digest: indexerDigestSchema,
  landing_mappings: z.array(indexerMaterialAnswerLandingMappingSchema),
}).strict();

export const indexerMaterialAnswerLayoutProposalSchema =
  layoutProposalPayloadSchema.extend({
    proposal_digest: indexerDigestSchema,
  }).strict();

export type IndexerMaterialAnswerLandingMapping = z.infer<
  typeof indexerMaterialAnswerLandingMappingSchema
>;
export type IndexerMaterialAnswerLayoutProposal = z.infer<
  typeof indexerMaterialAnswerLayoutProposalSchema
>;

function mappingIdentity(mapping: IndexerMaterialAnswerLandingMapping): string {
  return [
    mapping.answer_landing_ref,
    mapping.actualized_target_ref,
    mapping.section_ref ?? "",
  ].join("\u0000");
}

function canonicalMappings(
  mappings: readonly IndexerMaterialAnswerLandingMapping[],
): IndexerMaterialAnswerLandingMapping[] {
  const parsed = mappings.map((mapping) =>
    indexerMaterialAnswerLandingMappingSchema.parse(mapping)
  ).sort((left, right) =>
    compareIndexerCanonicalText(mappingIdentity(left), mappingIdentity(right))
  );
  const identities = parsed.map(mappingIdentity);
  if (new Set(identities).size !== identities.length) {
    throw new TypeError("material-answer layout mappings must not repeat");
  }
  return parsed;
}

export function buildIndexerMaterialAnswerLayoutProposal(input: {
  layout_digest: string;
  landing_mappings: readonly IndexerMaterialAnswerLandingMapping[];
}): IndexerMaterialAnswerLayoutProposal {
  const payload = layoutProposalPayloadSchema.parse({
    protocol: "context.indexer.material-answer-layout-proposal/v1",
    layout_digest: input.layout_digest,
    landing_mappings: canonicalMappings(input.landing_mappings),
  });
  return indexerMaterialAnswerLayoutProposalSchema.parse({
    ...payload,
    proposal_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerMaterialAnswerLayoutProposal(
  value: unknown,
): IndexerMaterialAnswerLayoutProposal {
  const proposal = indexerMaterialAnswerLayoutProposalSchema.parse(value);
  const { proposal_digest: _digest, ...payload } = proposal;
  void _digest;
  if (indexerProtocolDigest(payload) !== proposal.proposal_digest) {
    throw new TypeError("material-answer layout proposal digest is invalid");
  }
  if (
    canonicalIndexerJson(proposal.landing_mappings) !==
      canonicalIndexerJson(canonicalMappings(proposal.landing_mappings))
  ) {
    throw new TypeError("material-answer layout proposal mappings are not canonical");
  }
  return proposal;
}

export function buildIndexerMaterialAnswerLayoutProposalFromLayout(input: {
  layout: unknown;
  landings: ReadonlyArray<{
    answer_landing_ref: string;
    artifact_id: string;
    section_key?: string;
  }>;
}): IndexerMaterialAnswerLayoutProposal {
  const layout = indexerLayoutProposalSchema.parse(input.layout);
  const { proposal_digest: _digest, ...layoutPayload } = layout;
  void _digest;
  if (indexerProtocolDigest(layoutPayload) !== layout.proposal_digest) {
    throw new TypeError("material-answer mapping requires a current layout proposal");
  }
  if (new Set(input.landings.map((landing) => landing.answer_landing_ref)).size !==
    input.landings.length) {
    throw new TypeError("material-answer landing refs must be unique within a layout");
  }
  const mappings = input.landings.map((landing) => {
    const artifacts = layout.artifacts.filter((artifact) =>
      artifact.artifact_id === landing.artifact_id
    );
    if (artifacts.length !== 1) {
      throw new TypeError(`material-answer landing has no unique Artifact ${landing.artifact_id}`);
    }
    const artifact = artifacts[0]!;
    if (landing.section_key === undefined) {
      return {
        answer_landing_ref: landing.answer_landing_ref,
        actualized_target_ref: artifact.artifact_ref,
      };
    }
    const sections = artifact.sections.filter((section) =>
      section.section_key === landing.section_key
    );
    if (sections.length !== 1) {
      throw new TypeError(`material-answer landing has no unique Section ${landing.section_key}`);
    }
    return {
      answer_landing_ref: landing.answer_landing_ref,
      actualized_target_ref: sections[0]!.section_ref,
      section_ref: sections[0]!.section_ref,
    };
  });
  return buildIndexerMaterialAnswerLayoutProposal({
    layout_digest: layout.proposal_digest,
    landing_mappings: mappings,
  });
}

export function buildIndexerMaterialAnswerLayoutProposalFromLayoutSet(input: {
  layout_proposal_set: unknown;
  landings: ReadonlyArray<{
    answer_landing_ref: string;
    indexer_id: string;
    artifact_id: string;
    section_key?: string;
  }>;
}): IndexerMaterialAnswerLayoutProposal {
  const layoutSet = validateIndexerLayoutProposalSet(input.layout_proposal_set);
  if (new Set(input.landings.map((landing) => landing.answer_landing_ref)).size !==
    input.landings.length) {
    throw new TypeError("material-answer landing refs must be unique within a layout set");
  }
  const mappings = input.landings.map((landing) => {
    const proposals = layoutSet.proposals.filter((proposal) =>
      proposal.indexer_id === landing.indexer_id
    );
    const artifacts = proposals.flatMap((proposal) => proposal.artifacts).filter((artifact) =>
      artifact.artifact_id === landing.artifact_id
    );
    if (artifacts.length !== 1) {
      throw new TypeError(
        `material-answer landing has no unique Artifact ${landing.indexer_id}/${landing.artifact_id}`,
      );
    }
    const artifact = artifacts[0]!;
    if (landing.section_key === undefined) {
      return {
        answer_landing_ref: landing.answer_landing_ref,
        actualized_target_ref: artifact.artifact_ref,
      };
    }
    const sections = artifact.sections.filter((section) =>
      section.section_key === landing.section_key
    );
    if (sections.length !== 1) {
      throw new TypeError(
        `material-answer landing has no unique Section ${landing.section_key}`,
      );
    }
    return {
      answer_landing_ref: landing.answer_landing_ref,
      actualized_target_ref: sections[0]!.section_ref,
      section_ref: sections[0]!.section_ref,
    };
  });
  return buildIndexerMaterialAnswerLayoutProposal({
    layout_digest: layoutSet.set_digest,
    landing_mappings: mappings,
  });
}
