import { z } from "zod";
import {
  compareIndexerLayout,
  indexerLayoutChangeReportSchema,
  validateIndexerApprovedLayoutProjection,
  validateIndexerLayoutChangeReport,
} from "./indexerLayoutChange.js";
import { validateIndexerLayoutProposalSet } from "./indexerLayoutProposalSet.js";
import {
  validateIndexerMaterialAnswerLayoutProposal,
} from "./indexerMaterialAnswerLayout.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const noPlannedOutputSchema = z.object({
  state: z.literal("not-required"),
  actualization_digest: z.null(),
  landing_mapping_count: z.literal(0),
}).strict();

const actualizedPlannedOutputSchema = z.object({
  state: z.literal("actualized"),
  actualization_digest: indexerDigestSchema,
  landing_mapping_count: z.number().int().nonnegative(),
}).strict();

const layoutTransitionPayloadSchema = z.object({
  protocol: z.literal("context.indexer.layout-transition/v1"),
  layout_proposal_set_digest: indexerDigestSchema,
  base_projection_digests: z.array(indexerDigestSchema),
  planned_output: z.discriminatedUnion("state", [
    noPlannedOutputSchema,
    actualizedPlannedOutputSchema,
  ]),
  change_reports: z.array(indexerLayoutChangeReportSchema),
  requires_confirmation: z.boolean(),
  gate: z.object({
    id: z.literal("confirm-layout-change"),
    authority: z.literal("human"),
    delegation: z.literal("forbidden"),
  }).strict().nullable(),
}).strict();

export const indexerLayoutTransitionSchema = layoutTransitionPayloadSchema.extend({
  transition_digest: indexerDigestSchema,
}).strict();

export type IndexerLayoutTransition = z.infer<typeof indexerLayoutTransitionSchema>;

export type IndexerPlannedOutputActualization =
  | { state: "not-required" }
  | { state: "actualized"; proposal: unknown };

function transitionPayload(
  value: IndexerLayoutTransition,
): Omit<IndexerLayoutTransition, "transition_digest"> {
  const { transition_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

export function buildIndexerLayoutTransition(input: {
  layout_proposal_set: unknown;
  base_projections: readonly unknown[];
  planned_output: IndexerPlannedOutputActualization;
}): IndexerLayoutTransition {
  const proposalSet = validateIndexerLayoutProposalSet(input.layout_proposal_set);
  const bases = input.base_projections.map(validateIndexerApprovedLayoutProjection)
    .sort((left, right) => compareIndexerCanonicalText(left.node_ref, right.node_ref));
  if (new Set(bases.map((base) => base.node_ref)).size !== bases.length) {
    throw new TypeError("layout transition base projections must have unique Nodes");
  }
  const proposalNodeRefs = new Set(proposalSet.proposals.map((proposal) =>
    proposal.node.node_ref
  ));
  if (bases.some((base) => !proposalNodeRefs.has(base.node_ref))) {
    throw new TypeError(
      "layout transition cannot remove a Node without Subject re-identification authority",
    );
  }
  const plannedOutput = input.planned_output.state === "not-required"
    ? noPlannedOutputSchema.parse({
      state: "not-required",
      actualization_digest: null,
      landing_mapping_count: 0,
    })
    : (() => {
      const actualization = validateIndexerMaterialAnswerLayoutProposal(
        input.planned_output.proposal,
      );
      if (actualization.layout_digest !== proposalSet.set_digest) {
        throw new TypeError(
          "planned-output actualization is stale for the current layout proposal set",
        );
      }
      const actualTargetRefs = new Set(proposalSet.proposals.flatMap((proposal) => [
        proposal.node.node_ref,
        ...proposal.artifacts.flatMap((artifact) => [
          artifact.artifact_ref,
          ...artifact.sections.map((section) => section.section_ref),
        ]),
      ]));
      if (actualization.landing_mappings.some((mapping) =>
        !actualTargetRefs.has(mapping.actualized_target_ref) ||
        (mapping.section_ref !== undefined &&
          (mapping.section_ref !== mapping.actualized_target_ref ||
            !actualTargetRefs.has(mapping.section_ref)))
      )) {
        throw new TypeError(
          "planned-output actualization targets are absent from the current layout",
        );
      }
      return actualizedPlannedOutputSchema.parse({
        state: "actualized",
        actualization_digest: actualization.proposal_digest,
        landing_mapping_count: actualization.landing_mappings.length,
      });
    })();
  const baseByNode = new Map(bases.map((base) => [base.node_ref, base]));
  const reports = proposalSet.proposals.map((proposal) => compareIndexerLayout({
    base: baseByNode.get(proposal.node.node_ref) ?? null,
    target: proposal,
  }));
  const requiresConfirmation = reports.some((report) => report.requires_confirmation);
  const payload = layoutTransitionPayloadSchema.parse({
    protocol: "context.indexer.layout-transition/v1",
    layout_proposal_set_digest: proposalSet.set_digest,
    base_projection_digests: bases.map((base) => base.projection_digest)
      .sort(compareIndexerCanonicalText),
    planned_output: plannedOutput,
    change_reports: reports,
    requires_confirmation: requiresConfirmation,
    gate: requiresConfirmation
      ? { id: "confirm-layout-change", authority: "human", delegation: "forbidden" }
      : null,
  });
  return indexerLayoutTransitionSchema.parse({
    ...payload,
    transition_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerLayoutTransition(value: unknown): IndexerLayoutTransition {
  const transition = indexerLayoutTransitionSchema.parse(value);
  if (indexerProtocolDigest(transitionPayload(transition)) !== transition.transition_digest) {
    throw new TypeError("layout transition digest is invalid");
  }
  const requiresConfirmation = transition.change_reports.some((report) =>
    validateIndexerLayoutChangeReport(report).requires_confirmation
  );
  if (
    requiresConfirmation !== transition.requires_confirmation ||
    (requiresConfirmation ? transition.gate === null : transition.gate !== null)
  ) {
    throw new TypeError("layout transition Gate state does not close its diff reports");
  }
  const expectedBaseDigests = [...transition.base_projection_digests]
    .sort(compareIndexerCanonicalText);
  if (
    new Set(expectedBaseDigests).size !== expectedBaseDigests.length ||
    canonicalIndexerJson(expectedBaseDigests) !==
      canonicalIndexerJson(transition.base_projection_digests)
  ) {
    throw new TypeError("layout transition base projection digests are not canonical");
  }
  return transition;
}
