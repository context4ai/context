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

export const indexerProviderFinalizationSemanticInputSchema = z.object({
  stage: z.literal("provider-finalization"),
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
  unit_type: z.string().min(1),
  partition_axis: z.string().min(1),
  groups: z.array(partitionGroupSchema),
  excluded: z.array(partitionDispositionSchema).default([]),
  unsupported: z.array(partitionUnsupportedSchema).default([]),
}).strict();

const failedPartitionInputSchema = z.object({
  stage: z.literal("partition"),
  outcome: z.literal("failed"),
  unit_type: z.string().min(1),
  partition_axis: z.string().min(1),
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

const authorSectionSchema = z.object({
  key: z.string().min(1),
  heading: z.string().min(1),
  markdown: z.string().min(1),
  source_items: z.array(z.string().min(1)).min(1),
  facts: z.array(z.string().min(1)).default([]),
  answers: z.array(z.string().min(1)).default([]),
}).strict();

const authorMemberDispositionSchema = z.object({
  item: z.string().min(1),
  state: z.enum(["covered", "catalog-only", "unsupported"]),
  section: z.string().min(1).optional(),
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

export const indexerAuthorSemanticInputSchema = z.object({
  stage: z.literal("author"),
  group_key: z.string().min(1),
  outcome: z.enum(["publish", "catalog-only", "request-material", "unsupported"]),
  artifact_intent: z.string().min(1).optional(),
  policy: z.string().min(1).optional(),
  target_resolutions: z.array(z.object({
    target: z.string().min(1),
    disposition: z.enum(["reuse-existing", "create-independent", "unresolved"]),
    reason_code: z.string().min(1).optional(),
  }).strict()).default([]),
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  sections: z.array(authorSectionSchema).default([]),
  member_dispositions: z.array(authorMemberDispositionSchema),
  material_gaps: z.array(authorMaterialGapSchema).default([]),
  diagnostics: z.array(authorDiagnosticSchema).default([]),
}).strict().superRefine((value, context) => {
  if (value.outcome === "publish" && value.sections.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sections"],
      message: "publish requires at least one reader-facing section",
    });
  }
  if (value.outcome === "publish" && value.title === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["title"],
      message: "publish requires a reader-facing title",
    });
  }
  if (value.outcome === "publish" && value.summary === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary"],
      message: "publish requires a reader-facing summary",
    });
  }
});

export type IndexerAuthorSemanticInput = z.infer<typeof indexerAuthorSemanticInputSchema>;

const postAuthorSectionSchema = z.object({
  key: z.string().min(1),
  heading: z.string().min(1),
  markdown: z.string().min(1),
  source_refs: z.array(z.string().min(1)).min(1),
}).strict();

export const indexerPostAuthorSemanticInputSchema = z.object({
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
}).strict().superRefine((value, context) => {
  if (value.outcome === "failed" && value.diagnostics.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["diagnostics"],
      message: "failed post-author composition requires a diagnostic",
    });
  }
});

export type IndexerPostAuthorSemanticInput = z.infer<
  typeof indexerPostAuthorSemanticInputSchema
>;

export const indexerStructureReviewInputSchema = z.object({
  stage: z.literal("structure-review"),
  decision: z.enum(["approved", "request-adjustment"]),
  feedback: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "request-adjustment" && value.feedback === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["feedback"],
      message: "request-adjustment requires feedback",
    });
  }
});

export const indexerLayoutConfirmationInputSchema = z.object({
  stage: z.literal("layout-confirmation"),
  decision: z.enum(["approved", "rejected"]),
  feedback: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "rejected" && value.feedback === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["feedback"],
      message: "rejected layout confirmation requires feedback",
    });
  }
});

export const indexerCurrentActionInputSchema = z.union([
  indexerProviderSelectionSemanticInputSchema,
  indexerProviderResolutionSemanticInputSchema,
  indexerProviderProgramAuthorizationSemanticInputSchema,
  indexerProviderFinalizationSemanticInputSchema,
  indexerPartitionSemanticInputSchema,
  indexerAuthorSemanticInputSchema,
  indexerPostAuthorSemanticInputSchema,
  indexerStructureReviewInputSchema,
  indexerLayoutConfirmationInputSchema,
]);

export type IndexerCurrentActionInput = z.infer<typeof indexerCurrentActionInputSchema>;

export function validateIndexerCurrentActionInput(value: unknown): IndexerCurrentActionInput {
  return indexerCurrentActionInputSchema.parse(value);
}
