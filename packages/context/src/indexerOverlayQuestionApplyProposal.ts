import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  indexerRegistryDigests,
  indexerRegistrySchema,
  parseIndexerRegistry,
  validateFinalizedIndexerRegistry,
  type IndexRequirement,
  type IndexerRegistry,
} from "./indexerRegistry.js";
import {
  indexerOverlayQuestionAmendmentSchema,
  indexerRequirementAmendmentConfirmationSchema,
  validateIndexerOverlayQuestionAmendment,
  validateIndexerRequirementAmendmentConfirmation,
} from "./indexerOverlayQuestionAmendment.js";

const registrySnapshotSchema = z.object({
  document_digest: indexerDigestSchema,
  requirement_set_digest: indexerDigestSchema,
  indexer_selection_digest: indexerDigestSchema,
  registry_digest: indexerDigestSchema,
}).strict();

export const indexerOverlayQuestionRegistryApplyProposalSchema = z.object({
  protocol: z.literal("context.indexer.overlay-question-registry-apply-proposal/v1"),
  project_ref: z.string().min(1),
  base_registry: registrySnapshotSchema,
  target_registry: registrySnapshotSchema,
  target_document: indexerRegistrySchema,
  target_document_content: z.string().min(1).max(4 * 1024 * 1024),
  amendment: indexerOverlayQuestionAmendmentSchema,
  confirmation: indexerRequirementAmendmentConfirmationSchema,
  overlay_contract_digest: indexerDigestSchema,
  overlay_trust_receipt_digest: indexerDigestSchema,
  rebind_receipt_digest: indexerDigestSchema,
  rebound_selection_digest: indexerDigestSchema,
  subject_key_schema_set_digest: indexerDigestSchema,
  finalized_validation_report_digests: z.array(indexerDigestSchema).min(1),
  proposal_digest: indexerDigestSchema,
}).strict();

export type IndexerOverlayQuestionRegistryApplyProposal = z.infer<
  typeof indexerOverlayQuestionRegistryApplyProposalSchema
>;

function documentDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function withoutDigest(
  value: IndexerOverlayQuestionRegistryApplyProposal,
): Omit<IndexerOverlayQuestionRegistryApplyProposal, "proposal_digest"> {
  const payload: Partial<IndexerOverlayQuestionRegistryApplyProposal> = { ...value };
  Reflect.deleteProperty(payload, "proposal_digest");
  return payload as Omit<IndexerOverlayQuestionRegistryApplyProposal, "proposal_digest">;
}

function withoutQuestions(requirement: IndexRequirement): Omit<IndexRequirement, "questions"> {
  const payload: Partial<IndexRequirement> = { ...requirement };
  Reflect.deleteProperty(payload, "questions");
  return payload as Omit<IndexRequirement, "questions">;
}

function assertOnlyQuestionBindingsChanged(input: {
  base: IndexerRegistry;
  target: IndexerRegistry;
  requirementId: string;
}): void {
  if (canonicalIndexerJson(input.base.indexers) !== canonicalIndexerJson(input.target.indexers)) {
    throw new TypeError("overlay coupled proposal cannot alter Indexer selection");
  }
  const baseRequirements = new Map(input.base.requirements.map((item) => [item.id, item]));
  const targetRequirements = new Map(input.target.requirements.map((item) => [item.id, item]));
  if (baseRequirements.size !== targetRequirements.size) {
    throw new TypeError("overlay coupled proposal cannot add or remove requirements");
  }
  for (const [id, baseRequirement] of baseRequirements) {
    const targetRequirement = targetRequirements.get(id);
    if (targetRequirement === undefined) {
      throw new TypeError("overlay coupled proposal replaced a requirement identity");
    }
    if (id === input.requirementId) {
      if (
        canonicalIndexerJson(withoutQuestions(baseRequirement)) !==
          canonicalIndexerJson(withoutQuestions(targetRequirement))
      ) {
        throw new TypeError("overlay coupled proposal may change only question bindings");
      }
    } else if (canonicalIndexerJson(baseRequirement) !== canonicalIndexerJson(targetRequirement)) {
      throw new TypeError("overlay coupled proposal changed an unrelated requirement");
    }
  }
}

function snapshot(content: string, registry: IndexerRegistry) {
  return {
    document_digest: documentDigest(content),
    ...(() => {
      const digests = indexerRegistryDigests(registry);
      return {
        requirement_set_digest: digests.requirementSetDigest,
        indexer_selection_digest: digests.indexerSelectionDigest,
        registry_digest: digests.registryDigest,
      };
    })(),
  };
}

export function buildIndexerOverlayQuestionRegistryApplyProposal(input: {
  project_ref: string;
  base_registry: IndexerRegistry;
  base_document_content: string;
  target_document_content: string;
  amendment: unknown;
  confirmation: unknown;
  rebind_receipt_digest: string;
  rebound_selection_digest: string;
  subject_key_schema_set_digest: string;
  finalized_validation_report_digests: readonly string[];
}): IndexerOverlayQuestionRegistryApplyProposal {
  validateFinalizedIndexerRegistry(input.base_registry);
  const amendment = validateIndexerOverlayQuestionAmendment(input.amendment);
  const confirmation = validateIndexerRequirementAmendmentConfirmation({
    amendment,
    confirmation: input.confirmation,
  });
  if (input.project_ref !== amendment.project_ref) {
    throw new TypeError("overlay coupled proposal project does not match amendment");
  }
  const parsedBase = parseIndexerRegistry(input.base_document_content, "overlay-proposal:base");
  if (canonicalIndexerJson(parsedBase) !== canonicalIndexerJson(input.base_registry)) {
    throw new TypeError("overlay coupled proposal base document does not match base registry");
  }
  const parsedTarget = parseIndexerRegistry(
    input.target_document_content,
    "overlay-proposal:target",
  );
  if (canonicalIndexerJson(parsedTarget) !== canonicalIndexerJson(amendment.target_registry)) {
    throw new TypeError("overlay coupled proposal target content does not match amendment");
  }
  validateFinalizedIndexerRegistry(parsedTarget);
  assertOnlyQuestionBindingsChanged({
    base: parsedBase,
    target: parsedTarget,
    requirementId: amendment.requirement_id,
  });
  const baseSnapshot = snapshot(input.base_document_content, parsedBase);
  const targetSnapshot = snapshot(input.target_document_content, parsedTarget);
  if (
    baseSnapshot.requirement_set_digest !== amendment.base_requirement_set_digest ||
    targetSnapshot.requirement_set_digest !== amendment.target_requirement_set_digest ||
    targetSnapshot.registry_digest !== amendment.target_registry_digest
  ) {
    throw new TypeError("overlay coupled proposal registry snapshots are stale");
  }
  const reports = [...input.finalized_validation_report_digests]
    .sort(compareIndexerCanonicalText);
  if (new Set(reports).size !== reports.length || reports.length === 0) {
    throw new TypeError("overlay coupled proposal requires unique finalized validation reports");
  }
  const payload: Omit<IndexerOverlayQuestionRegistryApplyProposal, "proposal_digest"> = {
    protocol: "context.indexer.overlay-question-registry-apply-proposal/v1",
    project_ref: input.project_ref,
    base_registry: baseSnapshot,
    target_registry: targetSnapshot,
    target_document: parsedTarget,
    target_document_content: input.target_document_content,
    amendment,
    confirmation,
    overlay_contract_digest: amendment.overlay_digest,
    overlay_trust_receipt_digest: amendment.overlay_trust_receipt_digest,
    rebind_receipt_digest: input.rebind_receipt_digest,
    rebound_selection_digest: input.rebound_selection_digest,
    subject_key_schema_set_digest: input.subject_key_schema_set_digest,
    finalized_validation_report_digests: reports,
  };
  return validateIndexerOverlayQuestionRegistryApplyProposal({
    ...payload,
    proposal_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerOverlayQuestionRegistryApplyProposal(
  value: unknown,
): IndexerOverlayQuestionRegistryApplyProposal {
  const proposal = indexerOverlayQuestionRegistryApplyProposalSchema.parse(value);
  const amendment = validateIndexerOverlayQuestionAmendment(proposal.amendment);
  validateIndexerRequirementAmendmentConfirmation({
    amendment,
    confirmation: proposal.confirmation,
  });
  if (
    proposal.project_ref !== amendment.project_ref ||
    proposal.overlay_contract_digest !== amendment.overlay_digest ||
    proposal.overlay_trust_receipt_digest !== amendment.overlay_trust_receipt_digest ||
    proposal.base_registry.requirement_set_digest !== amendment.base_requirement_set_digest ||
    proposal.target_registry.requirement_set_digest !== amendment.target_requirement_set_digest ||
    proposal.target_registry.registry_digest !== amendment.target_registry_digest
  ) {
    throw new TypeError("overlay coupled proposal does not bind its amendment");
  }
  const target = parseIndexerRegistry(
    proposal.target_document_content,
    "overlay-proposal:target",
  );
  if (
    canonicalIndexerJson(target) !== canonicalIndexerJson(proposal.target_document) ||
    canonicalIndexerJson(target) !== canonicalIndexerJson(amendment.target_registry)
  ) {
    throw new TypeError("overlay coupled proposal target snapshot is inconsistent");
  }
  const targetSnapshot = snapshot(proposal.target_document_content, target);
  if (canonicalIndexerJson(targetSnapshot) !== canonicalIndexerJson(proposal.target_registry)) {
    throw new TypeError("overlay coupled proposal target digests are invalid");
  }
  if (
    proposal.finalized_validation_report_digests.length === 0 ||
    new Set(proposal.finalized_validation_report_digests).size !==
      proposal.finalized_validation_report_digests.length ||
    canonicalIndexerJson(proposal.finalized_validation_report_digests) !==
      canonicalIndexerJson(
        [...proposal.finalized_validation_report_digests].sort(compareIndexerCanonicalText),
      )
  ) {
    throw new TypeError("overlay coupled proposal validation reports are not canonical");
  }
  if (indexerProtocolDigest(withoutDigest(proposal)) !== proposal.proposal_digest) {
    throw new TypeError("overlay coupled proposal digest is invalid");
  }
  return proposal;
}

export function indexerOverlayQuestionDocumentDigest(content: string): string {
  return documentDigest(content);
}
