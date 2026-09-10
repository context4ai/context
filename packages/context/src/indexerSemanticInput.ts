import { indexerIdSchema } from "./indexerProtocolCommon.js";
import { readingStructureUpdateSchema } from "./readingStructure.js";
import { indexerArticleKeySchema, indexerArticlePlanSchema } from "./indexerArticlePlan.js";
import { z } from "zod";
import { indexerRegistryEntrySchema } from "./indexerRegistry.js";

const providerObservationSchema = z.object({
  skill: z.string().min(1),
  version: z.string().min(1).nullable(),
  source_type: z.enum([
    "community-plugin",
    "workspace",
    "installed-plugin",
    "marketplace",
  ]),
}).strict();

export const indexerProviderSelectionSemanticInputSchema = z.object({
  stage: z.literal("provider-selection"),
  host_visible_skills: z.array(providerObservationSchema).default([]),
  indexers: z.array(indexerRegistryEntrySchema).min(1),
}).strict();

export type IndexerProviderSelectionSemanticInput = z.infer<
  typeof indexerProviderSelectionSemanticInputSchema
>;

export const indexerProviderResolutionSemanticInputSchema = z.object({
  stage: z.literal("provider-resolution"),
  result: z.record(z.unknown()),
  managed_output: z.object({
    ref: z.string().min(1),
    digest: z.string().min(1),
    value: z.unknown(),
  }).strict().optional(),
}).strict();

export const indexerProviderProgramAuthorizationSemanticInputSchema = z.object({
  stage: z.literal("provider-program-authorization"),
  decision: z.enum(["approved", "rejected"]),
}).strict();

const subjectChoiceSchema = z.union([
  z.string().min(1),
  z.object({
    namespace: z.string().min(1),
    kind: z.string().min(1),
    local_key: z.string().min(1),
  }).strict(),
]);

const partitionGroupSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  reader_task: z.string().min(1),
  artifact_intent: z.string().min(1).optional(),
  template_id: z.string().min(1).optional(),
  articles: z.array(indexerArticlePlanSchema).min(1).optional(),
  priority: z.number().int().nonnegative().optional(),
  delivery_boundary: z.boolean().optional(),
  ready_for_author: z.boolean().optional(),
  subject: subjectChoiceSchema,
  subject_intent: z.enum(["primary", "enrich-or-independent"]),
  members: z.array(z.string().min(1)).min(1),
  questions: z.array(z.string().min(1)).default([]),
  question_targets: z.array(z.object({
    target: z.string().min(1),
    role: z.enum(["primary-carrier", "enricher"]),
  }).strict()).default([]),
  outline: z.array(z.string().min(1)).min(1),
}).strict();

const partitionDispositionSchema = z.object({
  item: z.string().min(1),
  reason_code: z.string().min(1),
}).strict();

const partitionUnsupportedSchema = z.object({
  item: z.string().min(1),
  missing_capabilities: z.array(z.string().min(1)).min(1),
}).strict();

const completePartitionInputSchema = z.object({
  stage: z.literal("partition"),
  outcome: z.literal("complete"),
  groups: z.array(partitionGroupSchema),
  excluded: z.array(partitionDispositionSchema).default([]),
  unsupported: z.array(partitionUnsupportedSchema).default([]),
}).strict();

const failedPartitionInputSchema = z.object({
  stage: z.literal("partition"),
  outcome: z.literal("failed"),
  groups: z.array(partitionGroupSchema).default([]),
  excluded: z.array(partitionDispositionSchema).default([]),
  unsupported: z.array(partitionUnsupportedSchema).default([]),
  failure: z.object({
    code: z.enum([
      "unsupported-domain",
      "no-stable-axis",
      "insufficient-identity-facts",
      "invalid-input",
      "strategy-failed",
    ]),
    message: z.string().min(1),
    unassigned: z.array(z.string().min(1)),
    missing_capabilities: z.array(z.string().min(1)).optional(),
    missing_sources: z.array(z.string().min(1)).optional(),
  }).strict(),
}).strict();

export const indexerPartitionSemanticInputSchema = z.union([
  completePartitionInputSchema,
  failedPartitionInputSchema,
]);

export type IndexerPartitionSemanticInput = z.infer<
  typeof indexerPartitionSemanticInputSchema
>;

export function validateIndexerPartitionSemanticInput(
  value: unknown,
): IndexerPartitionSemanticInput {
  return indexerPartitionSemanticInputSchema.parse(value);
}

const authorVisualSchema = z.object({
  resource: z.string().min(1),
  also_read: z.array(z.string().min(1)).optional(),
  context: z.array(z.string()).default([]),
  requirements: z.string().default(""),
  disposition: z.enum(["converted", "retained"]),
  format: z.enum(["mermaid", "table", "original"]),
  markdown: z.string().optional(),
  reason: z.string().optional(),
}).strict();

const authorSectionSchema = z.object({
  key: z.string().min(1),
  heading: z.string().min(1),
  visuals: z.array(authorVisualSchema).optional(),
  markdown: z.string().min(1),
  source_items: z.array(z.string().min(1)).default([]),
  facts: z.array(z.string().min(1)).default([]),
  answers: z.array(z.string().min(1)).default([]),
}).strict();

const authorTemplateVariablesSchema = z.record(z.union([
  z.string(),
  z.object({
    value: z.string(),
    source_items: z.array(z.string().min(1)).default([]),
    facts: z.array(z.string().min(1)).default([]),
  }).strict(),
]));

const authorMemberDispositionSchema = z.object({
  item: z.string().min(1),
  state: z.enum(["covered", "catalog-only", "unsupported"]),
  section: z.string().min(1).optional(),
  article: indexerArticleKeySchema.optional(),
  reason_code: z.string().min(1).optional(),
}).strict();

const authorMaterialGapSchema = z.object({
  question: z.string().min(1),
  source_hints: z.array(z.string().min(1)).default([]),
}).strict();

const authorDiagnosticSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  target: z.string().min(1).optional(),
}).strict();

const authorInputBaseSchema = z.object({
  stage: z.literal("author"),
  group_key: z.string().min(1),
  outcome: z.enum(["publish", "catalog-only", "request-material", "unsupported"]),
  articles: z.array(z.object({
    key: indexerArticleKeySchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    artifact_intent: z.string().min(1).optional(),
    template_variables: authorTemplateVariablesSchema.optional(),
    sections: z.array(authorSectionSchema).min(1),
  }).strict()).min(1).optional(),
  artifact_intent: z.string().min(1).optional(),
  template_variables: authorTemplateVariablesSchema.optional(),
  example_candidates: z.array(z.object({
    scenario_key: indexerIdSchema,
    source_item: z.string().min(1),
  }).strict()).optional(),
  policy: z.string().min(1).optional(),
  target_resolutions: z.array(z.object({
    target: z.string().min(1),
    disposition: z.enum(["reuse-existing", "create-independent", "unresolved"]),
    reason_code: z.string().min(1).optional(),
  }).strict()).default([]),
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  sections: z.array(authorSectionSchema).default([]),
  member_dispositions: z.array(z.union([
    authorMemberDispositionSchema,
    authorMemberDispositionSchema.omit({ item: true }).extend({ items: z.array(z.string().min(1)).min(1) }).strict(),
  ])).transform(entries => entries.flatMap(entry => {
    if ("item" in entry) return [entry];
    const { items, ...disposition } = entry;
    return items.map(item => ({ item, ...disposition }));
  })),
  material_gaps: z.array(authorMaterialGapSchema).default([]),
  diagnostics: z.array(authorDiagnosticSchema).default([]),
}).strict();

// Keep conditional input requirements structural so the delivered JSON Schema
// and the runtime parser describe the same submission, including defaults.
export const indexerAuthorSemanticInputSchema = z.union([
  authorInputBaseSchema.extend({
    outcome: z.literal("publish"),
    title: z.string().min(1),
    summary: z.string().min(1),
    sections: z.array(authorSectionSchema).min(1),
  }),
  authorInputBaseSchema.extend({
    outcome: z.literal("publish"),
    articles: authorInputBaseSchema.shape.articles.unwrap(),
    title: z.string().optional(), summary: z.string().optional(),
    sections: z.array(authorSectionSchema).max(0).default([]),
  }),
  authorInputBaseSchema.extend({ outcome: z.literal("catalog-only") }),
  authorInputBaseSchema.extend({ outcome: z.literal("request-material") }),
  authorInputBaseSchema.extend({ outcome: z.literal("unsupported") }),
]);

export type IndexerAuthorSemanticInput = z.infer<typeof indexerAuthorSemanticInputSchema>;

const indexerPartitionBatchSemanticInputSchema = z.object({
  stage: z.literal("partition"),
  results: z.array(z.object({
    task_key: z.string().regex(/^task-[0-9]{3}$/u),
    result: indexerPartitionSemanticInputSchema,
  }).strict()).min(1),
}).strict().superRefine((value, context) => {
  const keys = value.results.map((result) => result.task_key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["results"],
      message: "partition batch task keys must be unique",
    });
  }
});

const indexerAuthorBatchSemanticInputSchema = z.object({
  stage: z.literal("author"),
  results: z.array(z.object({
    task_key: z.string().regex(/^task-[0-9]{3}$/u),
    result: indexerAuthorSemanticInputSchema,
  }).strict()).min(1),
}).strict().superRefine((value, context) => {
  const keys = value.results.map((result) => result.task_key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["results"],
      message: "author batch task keys must be unique",
    });
  }
});

export type IndexerMainBatchSemanticInput = z.infer<
  typeof indexerPartitionBatchSemanticInputSchema |
  typeof indexerAuthorBatchSemanticInputSchema
>;

const indexerMainBatchSubmissionEnvelopeSchema = z.object({
  stage: z.enum(["partition", "author", "post-author"]),
  results: z.array(z.object({
    task_key: z.string(),
    result: z.unknown(),
  }).strict()).min(1),
}).strict();

export type IndexerMainBatchSubmissionEnvelope = z.infer<
  typeof indexerMainBatchSubmissionEnvelopeSchema
>;

const postAuthorSectionSchema = z.object({
  key: z.string().min(1),
  heading: z.string().min(1),
  visuals: z.array(authorVisualSchema).optional(),
  markdown: z.string().min(1),
  source_refs: z.array(z.string().min(1)).min(1),
}).strict();

const postAuthorInputBaseSchema = z.object({
  stage: z.literal("post-author"),
  outcome: z.enum(["complete", "failed"]),
  proposals: z.array(z.object({
    target: z.string().min(1),
    artifact_kind: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    sections: z.array(postAuthorSectionSchema).min(1),
  }).strict()).default([]),
  diagnostics: z.array(authorDiagnosticSchema).default([]),
}).strict();

export const indexerPostAuthorSemanticInputSchema = z.discriminatedUnion("outcome", [
  postAuthorInputBaseSchema.extend({ outcome: z.literal("complete") }),
  postAuthorInputBaseSchema.extend({
    outcome: z.literal("failed"),
    diagnostics: z.array(authorDiagnosticSchema).min(1),
  }),
]);

export type IndexerPostAuthorSemanticInput = z.infer<
  typeof indexerPostAuthorSemanticInputSchema
>;

const indexerPostAuthorBatchSemanticInputSchema = z.object({
  stage: z.literal("post-author"),
  results: z.array(z.object({
    task_key: z.string().regex(/^task-[0-9]{3}$/u),
    result: indexerPostAuthorSemanticInputSchema,
  }).strict()).min(1),
}).strict().superRefine((value, context) => {
  const keys = value.results.map((result) => result.task_key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["results"],
      message: "post-author batch task keys must be unique",
    });
  }
});

const structureReviewBaseSchema = z.object({
  stage: z.literal("structure-review"),
  reading_structure: readingStructureUpdateSchema.optional(),
  decision: z.enum(["approved", "exclude-obsolete", "request-adjustment"]),
  feedback: z.string().min(1).optional(),
}).strict();

export const indexerStructureReviewInputSchema = z.discriminatedUnion("decision", [
  structureReviewBaseSchema.extend({ decision: z.literal("approved") }),
  structureReviewBaseSchema.extend({ decision: z.literal("exclude-obsolete") }),
  structureReviewBaseSchema.extend({
    decision: z.literal("request-adjustment"),
    feedback: z.string().min(1),
  }),
]);

const layoutConfirmationBaseSchema = z.object({
  stage: z.literal("layout-confirmation"),
  decision: z.enum(["approved", "rejected"]),
  feedback: z.string().min(1).optional(),
  paths: z.array(z.object({
    artifact_ref: z.string().min(1),
    output_path: z.string().min(1),
  }).strict()).min(1).optional(),
}).strict();

export const indexerLayoutConfirmationInputSchema = z.discriminatedUnion("decision", [
  layoutConfirmationBaseSchema.extend({ decision: z.literal("approved") }),
  layoutConfirmationBaseSchema.omit({ paths: true }).extend({
    decision: z.literal("rejected"),
    feedback: z.string().min(1),
  }),
]);

export const approvedRevisionSemanticInputSchema = z.union([
  z.object({ stage: z.literal("approved-revision"), markdown: z.string().min(1) }).strict(),
  z.object({
    stage: z.literal("approved-revision"),
    sections: z.array(z.object({
      section_id: z.string().min(1),
      content: z.array(z.union([
        z.object({ markdown: z.string() }).strict(),
        z.object({ program: z.string().min(1) }).strict(),
      ])).min(1),
    }).strict()).min(1),
  }).strict(),
]);

export const sourceUpdateSemanticInputSchema = z.object({
  stage: z.literal("source-update"),
  decisions: z.array(z.object({ path: z.string().min(1), instruction: z.string().trim().min(1).optional(),
    supporting_sources: z.array(z.string().min(1)).min(1).optional() }).strict()),
  scope_summary: z.string().trim().min(1),
  new_topics: z.array(z.object({ path: z.string().trim().min(1), title: z.string().trim().min(1),
    source_refs: z.array(z.string().min(1)).min(1), instruction: z.string().trim().min(1) }).strict()),
}).strict();

/** Build-time input schema sources; the CLI exports these into its existing contract. */
export const indexerCurrentActionInputDefinitions = {
  sourceUpdate: sourceUpdateSemanticInputSchema,
  approvedRevision: approvedRevisionSemanticInputSchema,
  providerSelection: indexerProviderSelectionSemanticInputSchema,
  providerResolution: indexerProviderResolutionSemanticInputSchema,
  providerProgramAuthorization: indexerProviderProgramAuthorizationSemanticInputSchema,
  partitionBatch: indexerPartitionBatchSemanticInputSchema,
  authorBatch: indexerAuthorBatchSemanticInputSchema,
  postAuthor: indexerPostAuthorBatchSemanticInputSchema,
  structureReview: indexerStructureReviewInputSchema,
  layoutConfirmation: indexerLayoutConfirmationInputSchema,
};

export const indexerCurrentActionInputSchema = z.union([
  sourceUpdateSemanticInputSchema,
  approvedRevisionSemanticInputSchema,
  indexerProviderSelectionSemanticInputSchema,
  indexerProviderResolutionSemanticInputSchema,
  indexerProviderProgramAuthorizationSemanticInputSchema,
  indexerPartitionBatchSemanticInputSchema,
  indexerAuthorBatchSemanticInputSchema,
  indexerPostAuthorBatchSemanticInputSchema,
  indexerStructureReviewInputSchema,
  indexerLayoutConfirmationInputSchema,
]);

export type IndexerCurrentActionInput = z.infer<typeof indexerCurrentActionInputSchema>;

export function validateIndexerCurrentActionInput(value: unknown): IndexerCurrentActionInput {
  return indexerCurrentActionInputSchema.parse(value);
}

/**
 * Parses the current Action envelope without rejecting valid peer results when
 * one Partition, Author, or post-author task has an invalid nested result. Callers must
 * validate each nested result with its stage schema before committing it.
 */
export function parseIndexerCurrentActionSubmission(
  value: unknown,
): IndexerCurrentActionInput | IndexerMainBatchSubmissionEnvelope {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Reflect.get(value, "stage") === "partition" ||
      Reflect.get(value, "stage") === "author" ||
      Reflect.get(value, "stage") === "post-author")
  ) {
    return indexerMainBatchSubmissionEnvelopeSchema.parse(value);
  }
  return validateIndexerCurrentActionInput(value);
}
