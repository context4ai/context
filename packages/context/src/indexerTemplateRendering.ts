import { z } from "zod";
import {
  indexerDeterministicBlockRendererSchema,
  indexerRenderedContentBlockSchema,
  validateIndexerRenderedContentBlock,
} from "./indexerContentLayers.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  INDEXER_EVIDENCE_KINDS,
  addDuplicateIssues,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const templateVariableTypeSchema = z.enum([
  "string",
  "string-list",
  "string-map",
  "number",
  "boolean",
  "json",
]);

const templateVariableContractSchema = z.object({
  id: indexerIdSchema,
  type: templateVariableTypeSchema,
  content_layer: z.enum(["deterministic-fact", "semantic-prose"]),
  required: z.boolean(),
  evidence_required: z.boolean(),
  maximum_length: z.number().int().positive().max(262_144).optional(),
  maximum_items: z.number().int().positive().max(512).optional(),
}).strict().superRefine((value, context) => {
  if (value.maximum_length !== undefined && value.type !== "string") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "maximum_length is only valid for string variables",
      path: ["maximum_length"],
    });
  }
  if (
    value.maximum_items !== undefined &&
    value.type !== "string-list" &&
    value.type !== "string-map"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "maximum_items is only valid for collection variables",
      path: ["maximum_items"],
    });
  }
});

const deterministicBlockSchema = z.object({
  id: indexerIdSchema,
  renderer: indexerDeterministicBlockRendererSchema,
  source_variable_id: indexerIdSchema,
}).strict();

const templateSectionSchema = z.object({
  section_key: indexerIdSchema,
  presence: z.enum(["required", "optional"]),
  question_ref: indexerCanonicalRefSchema,
  reader_goal: indexerIdSchema,
  variable_ids: z.array(indexerIdSchema),
  deterministic_block_ids: z.array(indexerIdSchema),
  accepted_evidence_kinds: z.array(z.enum(INDEXER_EVIDENCE_KINDS)),
  minimum_evidence_items: z.number().int().nonnegative().max(128),
  on_missing: z.enum(["request-input", "omit"]),
  deletion_condition: z.string().min(1),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.variable_ids, context, "variable_ids");
  addDuplicateIssues(value.deterministic_block_ids, context, "deterministic_block_ids");
  addDuplicateIssues(value.accepted_evidence_kinds, context, "accepted_evidence_kinds");
  const expected = value.presence === "required" ? "request-input" : "omit";
  if (value.on_missing !== expected) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.presence} Section must use on_missing=${expected}`,
      path: ["on_missing"],
    });
  }
  if (
    value.presence === "required" &&
    (value.minimum_evidence_items === 0 || value.accepted_evidence_kinds.length === 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "required Section must require at least one accepted evidence item",
      path: ["minimum_evidence_items"],
    });
  }
  if (value.minimum_evidence_items > 0 && value.accepted_evidence_kinds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "evidence cardinality requires at least one accepted evidence kind",
      path: ["accepted_evidence_kinds"],
    });
  }
});

export const indexerTemplateContractSchema = z.object({
  protocol: z.literal("context.indexer.template/v1"),
  template_id: indexerIdSchema,
  profile: indexerIdSchema,
  reader_goal: indexerIdSchema,
  applicability: z.object({
    artifact_policy_variants: z.array(indexerIdSchema).min(1),
    condition_refs: z.array(indexerCanonicalRefSchema),
  }).strict(),
  variables: z.array(templateVariableContractSchema),
  deterministic_blocks: z.array(deterministicBlockSchema),
  sections: z.array(templateSectionSchema).min(1),
  page_policy: z.object({
    split_suggestion: z.string().min(1),
    semantic_boundaries: z.array(z.string().min(1)).min(1),
    keep_single_page_conditions: z.array(z.string().min(1)).min(1),
  }).strict(),
  anonymous_section_examples: z.array(z.string().min(1)).min(1),
  anti_examples: z.array(z.string().min(1)).min(1),
  forbidden_outputs: z.array(z.string().min(1)).min(1),
  maximum_rendered_bytes: z.number().int().positive().max(4_194_304),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.applicability.artifact_policy_variants, context, "artifact_policy_variants");
  addDuplicateIssues(value.applicability.condition_refs, context, "condition_refs");
  addDuplicateIssues(value.variables.map((item) => item.id), context, "variables");
  addDuplicateIssues(value.deterministic_blocks.map((item) => item.id), context, "deterministic_blocks");
  addDuplicateIssues(value.sections.map((item) => item.section_key), context, "sections");
  addDuplicateIssues(value.sections.map((item) => item.question_ref), context, "section question refs");
  const variables = new Map(value.variables.map((item) => [item.id, item]));
  const blocks = new Map(value.deterministic_blocks.map((item) => [item.id, item]));
  value.deterministic_blocks.forEach((block, index) => {
    const variable = variables.get(block.source_variable_id);
    const compatible = block.renderer === "bullet-list"
      ? variable?.type === "string-list"
      : block.renderer === "key-value-table"
      ? variable?.type === "string-map"
      : variable !== undefined;
    if (!compatible) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "deterministic block renderer is incompatible with its source variable",
        path: ["deterministic_blocks", index, "source_variable_id"],
      });
    }
    if (variable?.content_layer !== "deterministic-fact") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "deterministic block source variables must use content_layer=deterministic-fact",
        path: ["deterministic_blocks", index, "source_variable_id"],
      });
    }
  });
  value.sections.forEach((section, index) => {
    for (const variableId of section.variable_ids) {
      if (!variables.has(variableId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Section references unknown variable ${variableId}`,
          path: ["sections", index, "variable_ids"],
        });
      }
    }
    for (const blockId of section.deterministic_block_ids) {
      if (!blocks.has(blockId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Section references unknown deterministic block ${blockId}`,
          path: ["sections", index, "deterministic_block_ids"],
        });
      }
    }
  });
  const usedVariables = new Set(value.sections.flatMap((section) => section.variable_ids));
  const usedBlocks = new Set(value.sections.flatMap((section) => section.deterministic_block_ids));
  if (value.variables.some((variable) => !usedVariables.has(variable.id))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "every template variable must be used by a Section",
      path: ["variables"],
    });
  }
  if (value.deterministic_blocks.some((block) => !usedBlocks.has(block.id))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "every deterministic block must be used by a Section",
      path: ["deterministic_blocks"],
    });
  }
});

const renderedSectionSchema = z.object({
  section_key: indexerIdSchema,
  owner_indexer_id: indexerIdSchema,
  document_kind: indexerIdSchema,
  reader_goal: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  markdown: z.string().min(1),
  content_blocks: z.array(indexerRenderedContentBlockSchema).min(1),
  evidence_refs: z.array(indexerCanonicalRefSchema),
  content_digest: indexerDigestSchema,
}).strict();

const renderedMaterialGapSchema = z.object({
  section_key: indexerIdSchema,
  question_ref: indexerCanonicalRefSchema,
  question_target_key: indexerCanonicalRefSchema,
  material_question_proposal_ref: indexerCanonicalRefSchema,
}).strict();

export const indexerRenderedArtifactSchema = z.object({
  protocol: z.literal("context.indexer.rendered-artifact/v1"),
  artifact_result_digest: indexerDigestSchema,
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  artifact_policy_variant: indexerIdSchema,
  template_id: indexerIdSchema,
  profile: indexerIdSchema,
  template_digest: indexerDigestSchema,
  template_origin: z.enum(["provider", "customization-override"]),
  sections: z.array(renderedSectionSchema),
  material_question_gaps: z.array(renderedMaterialGapSchema),
  review_ready: z.boolean(),
  rendered_digest: indexerDigestSchema,
}).strict();

export type IndexerTemplateContract = z.infer<typeof indexerTemplateContractSchema>;
export type IndexerRenderedArtifact = z.infer<typeof indexerRenderedArtifactSchema>;

export function indexerRenderedArtifactDigest(
  value: Omit<IndexerRenderedArtifact, "rendered_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function validateIndexerRenderedArtifact(value: unknown): IndexerRenderedArtifact {
  const rendered = indexerRenderedArtifactSchema.parse(value);
  const payload = Object.fromEntries(
    Object.entries(rendered).filter(([key]) => key !== "rendered_digest"),
  ) as Omit<IndexerRenderedArtifact, "rendered_digest">;
  if (indexerRenderedArtifactDigest(payload) !== rendered.rendered_digest) {
    throw new TypeError("rendered Artifact digest is invalid");
  }
  const sectionKeys = rendered.sections.map((section) => section.section_key);
  const gapKeys = rendered.material_question_gaps.map((gap) => gap.section_key);
  if (
    new Set(sectionKeys).size !== sectionKeys.length ||
    new Set(gapKeys).size !== gapKeys.length ||
    sectionKeys.some((key) => gapKeys.includes(key)) ||
    rendered.review_ready !== (gapKeys.length === 0)
  ) {
    throw new TypeError("rendered Artifact Section/gap state is inconsistent");
  }
  for (const section of rendered.sections) {
    const contentBlocks = section.content_blocks.map((block) =>
      validateIndexerRenderedContentBlock(block)
    );
    const markdown = contentBlocks.map((block) => block.markdown).join("");
    const blockEvidenceRefs = [...new Set(
      contentBlocks.flatMap((block) => block.evidence_refs),
    )].sort();
    if (
      markdown !== section.markdown ||
      blockEvidenceRefs.length !== section.evidence_refs.length ||
      blockEvidenceRefs.some((ref, index) => ref !== section.evidence_refs[index]) ||
      new Set(section.evidence_refs).size !== section.evidence_refs.length ||
      section.evidence_refs.some(
        (ref, index) => [...section.evidence_refs].sort()[index] !== ref,
      ) ||
      section.content_digest !== indexerProtocolDigest({
        markdown: section.markdown,
        content_blocks: section.content_blocks,
        evidence_refs: section.evidence_refs,
      })
    ) {
      throw new TypeError(`rendered Section ${section.section_key} integrity is invalid`);
    }
  }
  return rendered;
}
