import { validateIndexerPlannedArticles, type IndexerArticlePlan } from "./indexerArticlePlan.js";
import { z } from "zod";
import {
  indexerArtifactBundleSchema,
  validateIndexerArtifactBundlePolicy,
  validateIndexerArtifactPolicyEligibilityReport,
} from "./indexerArtifactPolicy.js";
import {
  indexerArtifactSchema,
  indexerArtifactSectionProjectionSchema,
  type IndexerArtifactSectionProjection,
} from "./indexerArtifact.js";
import {
  indexerCapabilityGroupEvidenceSchema,
} from "./indexerCapabilityGroupEvidence.js";
import {
  indexerInventoryDispositionSetSchema,
  validateIndexerInventoryDispositionSet,
} from "./indexerInventoryDisposition.js";
import {
  indexerCanonicalRefSchema,
  indexerProviderLayerRefSchema,
} from "./indexerLayerComposition.js";
import {
  INDEXER_EVIDENCE_KINDS,
  canonicalIndexerJson,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";
import type { IndexerMainAuthorWorkset } from "./indexerMainWorkset.js";

export const indexerEvidenceBindingSchema = z.object({
  evidence_ref: indexerCanonicalRefSchema,
  kind: z.enum(INDEXER_EVIDENCE_KINDS),
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  locator: z.object({
    path: portableIndexerPathSchema,
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive(),
  }).strict().superRefine((value, context) => {
    if (value.end_line < value.start_line) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "end_line must not precede start_line",
        path: ["end_line"],
      });
    }
  }),
  content_digest: indexerDigestSchema,
  coverage_tier: z.enum(["ast-catalog", "lightweight-evidence"]),
  binding_digest: indexerDigestSchema,
}).strict();

const logicalUnitSchema = z.object({
  group_key: z.string().min(1),
  logical_unit_ref: indexerCanonicalRefSchema,
}).strict();

const materialQuestionProposalSchema = z.object({
  proposal_ref: indexerCanonicalRefSchema,
  requirement_ref: indexerCanonicalRefSchema,
  question_ref: indexerCanonicalRefSchema,
  question_target_key: indexerCanonicalRefSchema,
  source_hints: z.array(indexerCanonicalRefSchema),
}).strict();

const questionTargetDispositionSchema = z.union([
  z.object({
    question_target_key: indexerCanonicalRefSchema,
    state: z.literal("answered"),
  }).strict(),
  z.object({
    question_target_key: indexerCanonicalRefSchema,
    state: z.literal("material-gap"),
    material_question_proposal_ref: indexerCanonicalRefSchema,
  }).strict(),
]);

const resultDiagnosticSchema = z.object({
  code: indexerIdSchema,
  message: z.string().min(1),
  target_ref: indexerCanonicalRefSchema.optional(),
}).strict();

export const indexerArtifactResultSchema = z.object({
  protocol: z.literal("context.indexer.artifact-result/v1"),
  author_workset_digest: indexerDigestSchema,
  partition_plan_binding_digest: indexerDigestSchema,
  group_projection_digest: indexerDigestSchema,
  indexer_id: indexerIdSchema,
  provider_layer_ref: indexerProviderLayerRefSchema,
  provider_integrity: indexerDigestSchema,
  provider_bundle_digest: indexerDigestSchema,
  config_fingerprint: indexerDigestSchema,
  customization_fingerprint: indexerDigestSchema.nullable(),
  requirement_ref: indexerCanonicalRefSchema,
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  source_role: indexerIdSchema,
  logical_unit: logicalUnitSchema,
  capability_group_evidence: indexerCapabilityGroupEvidenceSchema,
  inventory_dispositions: indexerInventoryDispositionSetSchema,
  artifacts: z.array(indexerArtifactSchema),
  artifact_bundle: indexerArtifactBundleSchema.nullable(),
  material_question_proposals: z.array(materialQuestionProposalSchema),
  question_target_dispositions: z.array(questionTargetDispositionSchema),
  diagnostics: z.array(resultDiagnosticSchema),
  input_digest: indexerDigestSchema,
  output_digest: indexerDigestSchema,
}).strict();

export type IndexerArtifactResult = z.infer<typeof indexerArtifactResultSchema>;
export type { IndexerArtifactSectionProjection };
export { indexerArtifactSectionProjectionSchema };

export function indexerEvidenceBindingDigest(
  value: Omit<z.infer<typeof indexerEvidenceBindingSchema>, "binding_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function indexerArtifactResultDigest(
  value: Omit<IndexerArtifactResult, "output_digest">,
): string {
  return indexerProtocolDigest(value);
}

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${field} must contain unique identities`);
  }
}

export interface IndexerAuthorizedEvidenceTarget {
  source_ref: string;
  module_refs: readonly string[];
}

export function indexerEvidenceTargetAllows(input: {
  targets: readonly IndexerAuthorizedEvidenceTarget[];
  source_ref: string;
  module_ref: string | null;
}): boolean {
  return input.targets.some((target) =>
    target.source_ref === input.source_ref &&
    (target.module_refs.length === 0 ||
      (input.module_ref !== null && target.module_refs.includes(input.module_ref)))
  );
}

export function validateIndexerArtifactResult(input: {
  planned_articles?: readonly IndexerArticlePlan[];
  result: unknown;
  workset: IndexerMainAuthorWorkset;
  expected_provider: {
    layer_ref: string;
    integrity: string;
    bundle_digest: string;
    config_fingerprint: string;
    customization_fingerprint: string | null;
  };
  expected_input_digest: string;
  allowed_question_targets: readonly {
    question_target_key: string;
    question_ref: string;
  }[];
  artifact_policy_eligibility: unknown;
  allowed_source_roles: readonly string[];
  authorized_evidence_targets?: readonly IndexerAuthorizedEvidenceTarget[];
  source_identity_inventory?: unknown;
  authorized_declaration_carriers?: {
    catalog_refs?: readonly string[];
    manifest_refs?: readonly string[];
  };
}): IndexerArtifactResult {
  const result = indexerArtifactResultSchema.parse(input.result);
  const payload = Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== "output_digest"),
  ) as Omit<IndexerArtifactResult, "output_digest">;
  if (indexerArtifactResultDigest(payload) !== result.output_digest) {
    throw new TypeError("ArtifactResult output digest is invalid");
  }
  if (input.planned_articles !== undefined) validateIndexerPlannedArticles(result, input.planned_articles);
  const expectedProvider = input.expected_provider;
  if (
    result.author_workset_digest !== input.workset.workset_digest ||
    result.partition_plan_binding_digest !== input.workset.partition_plan_binding_digest ||
    result.group_projection_digest !== input.workset.group_projection_digest ||
    result.indexer_id !== input.workset.indexer_id ||
    result.requirement_ref !== input.workset.requirement_ref ||
    result.source_ref !== input.workset.source_ref ||
    result.module_ref !== input.workset.module_ref ||
    result.logical_unit.group_key !== input.workset.group_key ||
    result.logical_unit.logical_unit_ref !== input.workset.logical_unit_ref ||
    result.provider_layer_ref !== expectedProvider.layer_ref ||
    result.provider_integrity !== expectedProvider.integrity ||
    result.provider_bundle_digest !== expectedProvider.bundle_digest ||
    result.config_fingerprint !== expectedProvider.config_fingerprint ||
    result.customization_fingerprint !== expectedProvider.customization_fingerprint ||
    result.input_digest !== input.expected_input_digest
  ) {
    throw new TypeError("ArtifactResult does not match its author authority/workset");
  }
  if (!input.allowed_source_roles.includes(result.source_role)) {
    throw new TypeError(`ArtifactResult uses undeclared source role ${result.source_role}`);
  }
  const eligibility = validateIndexerArtifactPolicyEligibilityReport(
    input.artifact_policy_eligibility,
  );
  if (
    eligibility.eligibility_digest !== input.workset.artifact_policy_eligibility_digest ||
    canonicalIndexerJson(eligibility.eligible_variants.map((variant) => variant.id)) !==
      canonicalIndexerJson(input.workset.allowed_artifact_policy_variants)
  ) {
    throw new TypeError("Artifact policy eligibility does not match its author workset");
  }
  assertUnique(result.artifacts.map(artifact => artifact.artifact_id), "artifacts");
  for (const artifact of result.artifacts) {
    if (!input.workset.allowed_artifact_policy_variants.includes(artifact.artifact_policy_variant)) {
      throw new TypeError("Artifact uses an ineligible policy variant");
    }
    const sections = artifact.representation === "sections" ? artifact.sections : artifact.section_projections;
    assertUnique(sections.map(section => section.section_key), "sections");
    for (const section of sections) {
      if (section.owner_indexer_id !== result.indexer_id || section.artifact_kind !== artifact.artifact_kind) {
        throw new TypeError("Section does not match its owner/kind");
      }
    }
    const references = artifact.representation === "sections"
      ? artifact.sections.flatMap(section => section.blocks.flatMap(block => block.references))
      : Object.values(artifact.variables).flatMap(variable => variable.references);
    for (const reference of references) {
      if (reference.source_ref !== result.source_ref &&
          !input.authorized_evidence_targets?.some(target => target.source_ref === reference.source_ref)) {
        throw new TypeError("Article reference escapes its authorized sources");
      }
    }
  }
  if (result.artifacts.length === 0 ? result.artifact_bundle !== null : result.artifact_bundle === null) {
    throw new TypeError("Artifact bundle must match the delivered article set");
  }
  if (result.artifact_bundle !== null) {
    if (result.artifact_bundle.logical_unit_ref !== result.logical_unit.logical_unit_ref) {
      throw new TypeError("Artifact bundle belongs to another workset");
    }
    validateIndexerArtifactBundlePolicy({
      bundle: result.artifact_bundle, eligibility,
      actual_artifacts: result.artifacts,
      allowed_question_refs: input.allowed_question_targets.map(target => target.question_ref),
    });
  }
  validateIndexerInventoryDispositionSet({
    value: result.inventory_dispositions, workset: input.workset,
    section_evidence_inventory: result.artifacts.flatMap(artifact =>
      (artifact.representation === "sections" ? artifact.sections : artifact.section_projections)
        .map(section => ({ artifact_id: artifact.artifact_id, section_key: section.section_key }))),
    capability_group_memberships: result.capability_group_evidence.capability_groups.map(group => ({
      capability_group_ref: group.capability_group_ref, member_ids: group.member_evidence.map(member => member.member_id),
    })),
    material_gap_proposal_refs: result.question_target_dispositions.flatMap(disposition =>
      disposition.state === "material-gap" ? [disposition.material_question_proposal_ref] : []),
  });
  const targets = new Map(input.allowed_question_targets.map(target => [target.question_target_key, target.question_ref]));
  assertUnique(result.question_target_dispositions.map(item => item.question_target_key), "question targets");
  const proposals = new Map(result.material_question_proposals.map(proposal => [proposal.proposal_ref, proposal]));
  assertUnique(result.material_question_proposals.map(proposal => proposal.proposal_ref), "material proposals");
  for (const proposal of proposals.values()) {
    if (proposal.requirement_ref !== result.requirement_ref || targets.get(proposal.question_target_key) !== proposal.question_ref) {
      throw new TypeError("Material proposal is outside the current question scope");
    }
  }
  for (const disposition of result.question_target_dispositions) {
    if (!targets.has(disposition.question_target_key)) throw new TypeError("Unknown question target");
    if (disposition.state === "material-gap" &&
        proposals.get(disposition.material_question_proposal_ref)?.question_target_key !== disposition.question_target_key) {
      throw new TypeError("Material gap references another question");
    }
  }
  return result;
}
