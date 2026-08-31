import { z } from "zod";
import {
  indexerArtifactBundleSchema,
  validateIndexerArtifactBundlePolicy,
  validateIndexerArtifactPolicyEligibilityReport,
  type IndexerArtifactPolicyEligibility,
} from "./indexerArtifactPolicy.js";
import {
  indexerArtifactContentBlockSchema,
  indexerArtifactFactSchema,
  indexerCanonicalJsonSchema,
  projectIndexerFactValue,
  type IndexerArtifactFact,
} from "./indexerContentLayers.js";
import {
  indexerCapabilityGroupEvidenceSchema,
  validateIndexerCapabilityGroupEvidence,
} from "./indexerCapabilityGroupEvidence.js";
import {
  indexerInventoryDispositionSetSchema,
  validateIndexerInventoryDispositionSet,
} from "./indexerInventoryDisposition.js";
import {
  indexerSectionEvidenceCarrierRef,
  indexerStructuredDeclarationSetSchema,
  validateIndexerStructuredDeclarationSet,
} from "./indexerStructuredDeclaration.js";
import {
  assertIndexerGeneratedAuthoringAuditClear,
  buildIndexerGeneratedAuthoringAudit,
  indexerStructuredClaimSetSchema,
  validateIndexerStructuredClaimSet,
} from "./indexerGeneratedAuthoringAudit.js";
import {
  indexerCanonicalRefSchema,
  indexerProviderLayerRefSchema,
} from "./indexerLayerComposition.js";
import {
  INDEXER_EVIDENCE_KINDS,
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";
import type { IndexerMainAuthorWorkset, IndexerTargetResolutionView } from "./indexerMainWorkset.js";
import { canonicalIndexerNodeRef, indexerSubjectKeySchema } from "./indexerSubjectIdentity.js";

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

export const indexerArtifactSectionProjectionSchema = z.object({
  section_key: indexerIdSchema,
  owner_indexer_id: indexerIdSchema,
  document_kind: indexerIdSchema,
  reader_goal: indexerIdSchema,
  artifact_kind: indexerIdSchema,
}).strict();

const artifactSectionSchema = indexerArtifactSectionProjectionSchema.extend({
  blocks: z.array(indexerArtifactContentBlockSchema).min(1),
}).strict();

const artifactTemplateVariableSchema = z.object({
  value: indexerCanonicalJsonSchema,
  fact_refs: z.array(indexerCanonicalRefSchema),
  evidence_refs: z.array(indexerCanonicalRefSchema),
}).strict();

const artifactCommonFields = {
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  artifact_policy_variant: indexerIdSchema,
};

const templateArtifactSchema = z.object({
  ...artifactCommonFields,
  representation: z.literal("template"),
  template_id: indexerIdSchema,
  variables: z.record(artifactTemplateVariableSchema),
  section_projections: z.array(indexerArtifactSectionProjectionSchema).min(1),
}).strict();

const sectionArtifactSchema = z.object({
  ...artifactCommonFields,
  representation: z.literal("sections"),
  sections: z.array(artifactSectionSchema).min(1),
}).strict();

const artifactSchema = z.discriminatedUnion("representation", [
  templateArtifactSchema,
  sectionArtifactSchema,
]);

const targetResolutionDispositionSchema = z.union([
  z.object({
    query_ref: indexerDigestSchema,
    disposition: z.literal("reuse-existing"),
    target_subject_key: indexerSubjectKeySchema,
    target_node_ref: indexerCanonicalRefSchema,
  }).strict(),
  z.object({
    query_ref: indexerDigestSchema,
    disposition: z.literal("create-independent"),
    subject_key: indexerSubjectKeySchema,
    reason_code: indexerIdSchema,
    evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
  }).strict(),
  z.object({
    query_ref: indexerDigestSchema,
    disposition: z.literal("request-material"),
    missing_facts: z.array(indexerIdSchema).min(1),
    source_hints: z.array(indexerCanonicalRefSchema),
  }).strict(),
  z.object({
    query_ref: indexerDigestSchema,
    disposition: z.literal("unsupported"),
    missing_capabilities: z.array(indexerIdSchema).min(1),
  }).strict(),
]);

const logicalUnitSchema = z.object({
  group_key: z.string().min(1),
  subject_key: indexerSubjectKeySchema,
  logical_unit_ref: indexerCanonicalRefSchema,
  target_resolution_dispositions: z.array(targetResolutionDispositionSchema),
}).strict();

const materialQuestionProposalSchema = z.object({
  proposal_ref: indexerCanonicalRefSchema,
  requirement_ref: indexerCanonicalRefSchema,
  question_ref: indexerCanonicalRefSchema,
  question_target_key: indexerCanonicalRefSchema,
  answer_landing_hint: z.object({
    artifact_id: indexerIdSchema,
    section_key: indexerIdSchema.optional(),
  }).strict().optional(),
  source_hints: z.array(indexerCanonicalRefSchema),
}).strict();

const questionTargetDispositionSchema = z.union([
  z.object({
    question_target_key: indexerCanonicalRefSchema,
    state: z.literal("answered"),
    evidence_binding_digest: indexerDigestSchema,
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
  structured_declarations: indexerStructuredDeclarationSetSchema.optional(),
  structured_claims: indexerStructuredClaimSetSchema.optional(),
  facts: z.array(indexerArtifactFactSchema),
  evidence_bindings: z.array(indexerEvidenceBindingSchema),
  artifacts: z.array(artifactSchema),
  artifact_bundle: indexerArtifactBundleSchema.nullable(),
  material_question_proposals: z.array(materialQuestionProposalSchema),
  question_target_dispositions: z.array(questionTargetDispositionSchema),
  diagnostics: z.array(resultDiagnosticSchema),
  input_digest: indexerDigestSchema,
  output_digest: indexerDigestSchema,
}).strict();

export type IndexerArtifactResult = z.infer<typeof indexerArtifactResultSchema>;
export type IndexerArtifactSectionProjection = z.infer<
  typeof indexerArtifactSectionProjectionSchema
>;

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

function assertCanonicalUnique(values: readonly string[], field: string): void {
  assertUnique(values, field);
  const expected = [...values].sort(compareIndexerCanonicalText);
  if (values.some((value, index) => expected[index] !== value)) {
    throw new TypeError(`${field} must be canonically sorted`);
  }
}

function validateEvidenceBindings(
  result: IndexerArtifactResult,
  workset: IndexerMainAuthorWorkset,
): Set<string> {
  assertUnique(
    result.evidence_bindings.map((item) => item.evidence_ref),
    "evidence_bindings.evidence_ref",
  );
  const refs = new Set<string>();
  for (const evidence of result.evidence_bindings) {
    const payload = Object.fromEntries(
      Object.entries(evidence).filter(([key]) => key !== "binding_digest"),
    ) as Omit<typeof evidence, "binding_digest">;
    if (indexerEvidenceBindingDigest(payload) !== evidence.binding_digest) {
      throw new TypeError(`evidence binding ${evidence.evidence_ref} digest is invalid`);
    }
    if (
      evidence.source_ref !== workset.source_ref ||
      evidence.module_ref !== workset.module_ref
    ) {
      throw new TypeError("ArtifactResult evidence escapes its source/module workset");
    }
    refs.add(evidence.evidence_ref);
  }
  return refs;
}

function validateEvidenceRefs(
  refs: readonly string[],
  known: ReadonlySet<string>,
  field: string,
): void {
  assertUnique(refs, field);
  if (refs.some((ref) => !known.has(ref))) {
    throw new TypeError(`${field} references unknown evidence`);
  }
}

function artifactEvidenceRefs(
  artifact: IndexerArtifactResult["artifacts"][number],
  facts: ReadonlyMap<string, IndexerArtifactFact>,
): string[] {
  const refs = artifact.representation === "sections"
    ? artifact.sections.flatMap((section) =>
        section.blocks.flatMap((block) => block.layer === "semantic-prose"
          ? block.evidence_refs
          : block.fact_refs.flatMap((ref) => facts.get(ref)?.evidence_refs ?? []))
      )
    : Object.values(artifact.variables).flatMap((variable) => variable.evidence_refs);
  return [...new Set(refs)].sort();
}

function sectionEvidenceInventory(
  result: IndexerArtifactResult,
  facts: ReadonlyMap<string, IndexerArtifactFact>,
) {
  return result.artifacts.flatMap((artifact) => {
    if (artifact.representation === "template") {
      const evidenceRefs = [...new Set(
        Object.values(artifact.variables).flatMap((variable) => variable.evidence_refs),
      )].sort();
      return artifact.section_projections.map((section) => ({
        artifact_id: artifact.artifact_id,
        section_key: section.section_key,
        evidence_refs: evidenceRefs,
      }));
    }
    return artifact.sections.map((section) => ({
      artifact_id: artifact.artifact_id,
      section_key: section.section_key,
      evidence_refs: [...new Set(section.blocks.flatMap((block) =>
        block.layer === "semantic-prose"
          ? block.evidence_refs
          : block.fact_refs.flatMap((ref) => facts.get(ref)?.evidence_refs ?? [])
      ))].sort(),
    }));
  });
}

function sectionDeclarationCarrierRefs(result: IndexerArtifactResult): string[] {
  return result.artifacts.flatMap((artifact) => {
    const sections = artifact.representation === "sections"
      ? artifact.sections
      : artifact.section_projections;
    return sections.map((section) => indexerSectionEvidenceCarrierRef({
      logical_unit_ref: result.logical_unit.logical_unit_ref,
      artifact_id: artifact.artifact_id,
      section_key: section.section_key,
    }));
  }).sort(compareIndexerCanonicalText);
}

function validateStructuredDeclarations(input: {
  result: IndexerArtifactResult;
  evidence_refs: ReadonlySet<string>;
  source_identity_inventory: unknown | undefined;
  authorized_carriers: {
    catalog_refs?: readonly string[];
    manifest_refs?: readonly string[];
  } | undefined;
}): void {
  if (input.result.structured_declarations === undefined) return;
  if (input.source_identity_inventory === undefined) {
    throw new TypeError(
      "structured declarations require the current CLI source identity inventory",
    );
  }
  validateIndexerStructuredDeclarationSet({
    value: input.result.structured_declarations,
    source_identity_inventory: input.source_identity_inventory,
    expected_source_ref: input.result.source_ref,
    expected_module_ref: input.result.module_ref,
    carrier_authority: {
      "indexer-result": [input.result.logical_unit.logical_unit_ref],
      catalog: [...(input.authorized_carriers?.catalog_refs ?? [])],
      manifest: [...(input.authorized_carriers?.manifest_refs ?? [])],
      "section-evidence": sectionDeclarationCarrierRefs(input.result),
    },
    known_evidence_refs: [...input.evidence_refs],
  });
}

function validateStructuredClaims(input: {
  result: IndexerArtifactResult;
  evidence_refs: ReadonlySet<string>;
  facts: ReadonlyMap<string, IndexerArtifactFact>;
}): void {
  if (input.result.structured_claims === undefined) return;
  const authorizedSubjects = new Set([
    input.result.logical_unit.logical_unit_ref,
    ...input.result.inventory_dispositions.dispositions.map((item) => item.member_id),
  ]);
  for (const disposition of input.result.logical_unit.target_resolution_dispositions) {
    if (disposition.disposition === "reuse-existing") {
      authorizedSubjects.add(disposition.target_node_ref);
    } else if (disposition.disposition === "create-independent") {
      authorizedSubjects.add(canonicalIndexerNodeRef(disposition.subject_key));
    }
  }
  validateIndexerStructuredClaimSet({
    value: input.result.structured_claims,
    expected_author_workset_digest: input.result.author_workset_digest,
    expected_logical_unit_ref: input.result.logical_unit.logical_unit_ref,
    authorized_subject_refs: [...authorizedSubjects],
    known_evidence_refs: [...input.evidence_refs],
    section_evidence_inventory: sectionEvidenceInventory(input.result, input.facts),
  });
}

function validateArtifacts(input: {
  result: IndexerArtifactResult;
  workset: IndexerMainAuthorWorkset;
  evidenceRefs: ReadonlySet<string>;
  facts: ReadonlyMap<string, IndexerArtifactFact>;
  eligibility: IndexerArtifactPolicyEligibility;
  allowedQuestionRefs: readonly string[];
}): void {
  const { result, workset, evidenceRefs } = input;
  assertUnique(result.artifacts.map((item) => item.artifact_id), "artifacts.artifact_id");
  for (const artifact of result.artifacts) {
    if (!workset.allowed_artifact_policy_variants.includes(artifact.artifact_policy_variant)) {
      throw new TypeError(
        `Artifact ${artifact.artifact_id} uses an ineligible policy variant`,
      );
    }
    if (artifact.representation === "sections") {
      assertUnique(
        artifact.sections.map((section) => section.section_key),
        `${artifact.artifact_id}.sections.section_key`,
      );
      for (const section of artifact.sections) {
        if (
          section.owner_indexer_id !== result.indexer_id ||
          section.artifact_kind !== artifact.artifact_kind
        ) {
          throw new TypeError("Artifact Section projection does not match its owner/kind");
        }
        assertUnique(
          section.blocks.map((block) => block.block_id),
          `${artifact.artifact_id}.${section.section_key}.blocks`,
        );
        for (const block of section.blocks) {
          if (block.layer === "semantic-prose") {
            validateEvidenceRefs(block.evidence_refs, evidenceRefs, "block.evidence_refs");
          } else {
            assertCanonicalUnique(block.fact_refs, "block.fact_refs");
            if (block.fact_refs.some((ref) => !input.facts.has(ref))) {
              throw new TypeError("deterministic block references unknown ArtifactResult Fact");
            }
          }
        }
      }
    } else {
      assertUnique(
        artifact.section_projections.map((section) => section.section_key),
        `${artifact.artifact_id}.section_projections.section_key`,
      );
      for (const section of artifact.section_projections) {
        if (
          section.owner_indexer_id !== result.indexer_id ||
          section.artifact_kind !== artifact.artifact_kind
        ) {
          throw new TypeError("Template Artifact Section projection does not match its owner/kind");
        }
      }
      for (const [variableId, variable] of Object.entries(artifact.variables)) {
        assertCanonicalUnique(
          variable.fact_refs,
          `${artifact.artifact_id}.variables.${variableId}.fact_refs`,
        );
        if (variable.fact_refs.some((ref) => !input.facts.has(ref))) {
          throw new TypeError(
            `${artifact.artifact_id}.variables.${variableId}.fact_refs references unknown Fact`,
          );
        }
        if (variable.fact_refs.length > 0) {
          const referencedFacts = variable.fact_refs.map((ref) => input.facts.get(ref)!);
          if (
            canonicalIndexerJson(variable.value) !==
              canonicalIndexerJson(projectIndexerFactValue(referencedFacts))
          ) {
            throw new TypeError(
              `${artifact.artifact_id}.variables.${variableId} changes its Fact projection`,
            );
          }
          const factEvidence = [...new Set(
            referencedFacts.flatMap((fact) => fact.evidence_refs),
          )].sort();
          const variableEvidence = [...variable.evidence_refs].sort();
          if (
            factEvidence.length !== variableEvidence.length ||
            factEvidence.some((ref, index) => ref !== variableEvidence[index])
          ) {
            throw new TypeError(
              `${artifact.artifact_id}.variables.${variableId} changes its Fact evidence`,
            );
          }
        }
        validateEvidenceRefs(
          variable.evidence_refs,
          evidenceRefs,
          `${artifact.artifact_id}.variables.${variableId}.evidence_refs`,
        );
      }
    }
  }
  if (result.artifacts.length === 0) {
    if (result.artifact_bundle !== null) {
      throw new TypeError("an empty Artifact Result cannot publish an Artifact Bundle");
    }
    return;
  }
  if (
    result.artifact_bundle === null ||
    result.artifact_bundle.logical_unit_ref !== result.logical_unit.logical_unit_ref
  ) {
    throw new TypeError("non-empty Artifact Result requires its exact logical-unit Bundle");
  }
  const mixedVariant = result.artifacts.find((artifact) =>
    artifact.artifact_policy_variant !== result.artifact_bundle!.artifact_policy_variant
  );
  if (mixedVariant !== undefined) {
    throw new TypeError("all Artifacts in one logical unit must use its Bundle variant");
  }
  validateIndexerArtifactBundlePolicy({
    bundle: result.artifact_bundle,
    eligibility: input.eligibility,
    actual_artifacts: result.artifacts.map((artifact) => ({
      artifact_id: artifact.artifact_id,
      artifact_kind: artifact.artifact_kind,
      evidence_refs: artifactEvidenceRefs(artifact, input.facts),
    })),
    allowed_question_refs: input.allowedQuestionRefs,
    known_evidence_refs: [...evidenceRefs],
  });
}

function validateTargetResolution(
  result: IndexerArtifactResult,
  view: IndexerTargetResolutionView | undefined,
  evidenceRefs: ReadonlySet<string>,
): void {
  const dispositions = result.logical_unit.target_resolution_dispositions;
  if (view === undefined) {
    if (dispositions.length !== 0) {
      throw new TypeError(
        "index-target-resolution-invalid: primary author Result cannot invent target resolution entries",
      );
    }
    return;
  }
  try {
    assertUnique(dispositions.map((item) => item.query_ref), "target resolution query_ref");
  } catch (error) {
    throw new TypeError(
      `index-target-resolution-invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const byQuery = new Map(dispositions.map((item) => [item.query_ref, item]));
  if (
    byQuery.size !== view.entries.length ||
    view.entries.some((entry) => !byQuery.has(entry.query_ref))
  ) {
    throw new TypeError(
      "index-target-resolution-invalid: ArtifactResult must close every TargetResolutionView query",
    );
  }
  for (const entry of view.entries) {
    if (entry.state === "ambiguous") throw new TypeError("index-target-resolution-ambiguous");
    const disposition = byQuery.get(entry.query_ref)!;
    if (disposition.disposition === "reuse-existing") {
      if (
        entry.state !== "resolved" ||
        disposition.target_node_ref !== entry.node_ref ||
        canonicalIndexerJson(disposition.target_subject_key) !==
          canonicalIndexerJson(entry.subject_key)
      ) {
        throw new TypeError("index-target-resolution-invalid: resolved identity mismatch");
      }
    } else if (disposition.disposition === "create-independent") {
      validateEvidenceRefs(disposition.evidence_refs, evidenceRefs, "independent evidence_refs");
      if (canonicalIndexerNodeRef(disposition.subject_key) ===
          (entry.state === "resolved" ? entry.node_ref : "")) {
        throw new TypeError(
          "index-target-resolution-invalid: create-independent must introduce a distinct SubjectKey",
        );
      }
    } else if (entry.state !== "absent") {
      throw new TypeError(
        "index-target-resolution-invalid: resolved targets cannot be reported as unavailable",
      );
    }
  }
}

function validateQuestions(input: {
  result: IndexerArtifactResult;
  allowed_question_targets: readonly {
    question_target_key: string;
    question_ref: string;
  }[];
}): void {
  const allowed = new Map(
    input.allowed_question_targets.map((item) => [item.question_target_key, item.question_ref]),
  );
  const proposals = new Map<string, z.infer<typeof materialQuestionProposalSchema>>();
  for (const proposal of input.result.material_question_proposals) {
    if (proposals.has(proposal.proposal_ref)) {
      throw new TypeError("material question proposal refs must be unique");
    }
    if (
      proposal.requirement_ref !== input.result.requirement_ref ||
      allowed.get(proposal.question_target_key) !== proposal.question_ref
    ) {
      throw new TypeError("material question proposal is outside CLI question authority");
    }
    if (proposal.answer_landing_hint !== undefined) {
      const artifact = input.result.artifacts.find(
        (item) => item.artifact_id === proposal.answer_landing_hint!.artifact_id,
      );
      if (artifact === undefined) throw new TypeError("answer landing references unknown Artifact");
      const sectionKey = proposal.answer_landing_hint.section_key;
      if (
        sectionKey !== undefined &&
        !(artifact.representation === "sections"
          ? artifact.sections.some((section) => section.section_key === sectionKey)
          : artifact.section_projections.some((section) => section.section_key === sectionKey))
      ) {
        throw new TypeError("answer landing references unknown Section");
      }
    }
    proposals.set(proposal.proposal_ref, proposal);
  }
  const evidenceDigests = new Set(
    input.result.evidence_bindings.map((item) => item.binding_digest),
  );
  assertUnique(
    input.result.question_target_dispositions.map((item) => item.question_target_key),
    "question_target_dispositions.question_target_key",
  );
  const referencedProposals = new Set<string>();
  for (const disposition of input.result.question_target_dispositions) {
    if (!allowed.has(disposition.question_target_key)) {
      throw new TypeError("question target disposition references unknown CLI target");
    }
    if (
      disposition.state === "answered" &&
      !evidenceDigests.has(disposition.evidence_binding_digest)
    ) {
      throw new TypeError("answered question target references unknown evidence binding");
    }
    if (
      disposition.state === "material-gap" &&
      proposals.get(disposition.material_question_proposal_ref)?.question_target_key !==
        disposition.question_target_key
    ) {
      throw new TypeError("material-gap disposition references another proposal/target");
    }
    if (disposition.state === "material-gap") {
      referencedProposals.add(disposition.material_question_proposal_ref);
    }
  }
  if ([...proposals.keys()].some((proposalRef) => !referencedProposals.has(proposalRef))) {
    throw new TypeError("material question proposal is not referenced by its target disposition");
  }
}

export function validateIndexerArtifactResult(input: {
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
  expected_subject_key: unknown;
  allowed_question_targets: readonly {
    question_target_key: string;
    question_ref: string;
  }[];
  artifact_policy_eligibility: unknown;
  allowed_source_roles: readonly string[];
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
    canonicalIndexerJson(result.logical_unit.subject_key) !==
      canonicalIndexerJson(input.expected_subject_key) ||
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
  const evidenceRefs = validateEvidenceBindings(result, input.workset);
  assertCanonicalUnique(result.facts.map((fact) => fact.fact_ref), "facts.fact_ref");
  const facts = new Map(result.facts.map((fact) => [fact.fact_ref, fact]));
  const allowedFactNodeRefs = new Set([result.logical_unit.logical_unit_ref]);
  for (const disposition of result.logical_unit.target_resolution_dispositions) {
    if (disposition.disposition === "reuse-existing") {
      allowedFactNodeRefs.add(disposition.target_node_ref);
    }
    if (disposition.disposition === "create-independent") {
      allowedFactNodeRefs.add(canonicalIndexerNodeRef(disposition.subject_key));
    }
  }
  for (const fact of result.facts) {
    if (!allowedFactNodeRefs.has(canonicalIndexerNodeRef(fact.subject_key))) {
      throw new TypeError("ArtifactResult fact belongs to another logical unit");
    }
    validateEvidenceRefs(fact.evidence_refs, evidenceRefs, "fact.evidence_refs");
  }
  validateArtifacts({
    result,
    workset: input.workset,
    evidenceRefs,
    facts,
    eligibility,
    allowedQuestionRefs: input.allowed_question_targets.map((target) => target.question_ref),
  });
  validateIndexerCapabilityGroupEvidence({
    value: result.capability_group_evidence,
    workset: input.workset,
    known_evidence_refs: [...evidenceRefs],
    section_evidence_inventory: sectionEvidenceInventory(result, facts),
  });
  validateIndexerInventoryDispositionSet({
    value: result.inventory_dispositions,
    workset: input.workset,
    known_evidence_refs: [...evidenceRefs],
    known_fact_refs: [...facts.keys()],
    section_evidence_inventory: sectionEvidenceInventory(result, facts),
    capability_group_memberships:
      result.capability_group_evidence.capability_groups.map((group) => ({
        capability_group_ref: group.capability_group_ref,
        member_ids: group.member_evidence.map((member) => member.member_id),
      })),
    material_gap_proposal_refs: result.question_target_dispositions.flatMap(
      (disposition) => disposition.state === "material-gap"
        ? [disposition.material_question_proposal_ref]
      : [],
    ),
  });
  validateStructuredDeclarations({
    result,
    evidence_refs: evidenceRefs,
    source_identity_inventory: input.source_identity_inventory,
    authorized_carriers: input.authorized_declaration_carriers,
  });
  validateStructuredClaims({ result, evidence_refs: evidenceRefs, facts });
  assertIndexerGeneratedAuthoringAuditClear(
    buildIndexerGeneratedAuthoringAudit(result),
  );
  validateTargetResolution(result, input.workset.target_resolution_view, evidenceRefs);
  validateQuestions({ result, allowed_question_targets: input.allowed_question_targets });
  return result;
}
