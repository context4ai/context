import { z } from "zod";

const confidenceAtomSchema = z
  .number()
  .min(0)
  .max(1)
  .optional()
  .catch(undefined) as unknown as z.ZodOptional<z.ZodNumber>;

export const entityAtomSchema = z.object({
  name: z.string(),
  kind: z.string().optional().catch(undefined) as unknown as z.ZodOptional<z.ZodString>,
  ref: z.string().optional(),
  confidence: confidenceAtomSchema,
});

export const relationAtomSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(),
  description: z.string().optional(),
  confidence: confidenceAtomSchema,
});

export const behaviorAtomSchema = z.object({
  name: z.string(),
  signature: z.string().optional(),
  description: z.string().optional(),
  performed_by: z.array(z.string()).optional(),
  ref: z.string().optional(),
  confidence: confidenceAtomSchema,
});

export const attributeAtomSchema = z.object({
  name: z.string(),
  type: z.string(),
  value: z.unknown().optional(),
  confidence: confidenceAtomSchema,
});

export const stateAtomSchema = z.object({
  name: z.string(),
  values: z.array(z.string()),
  ref_sor: z.string().optional(),
  confidence: confidenceAtomSchema,
});

export const ruleAtomSchema = z.object({
  description: z.string(),
  expression: z.string().optional(),
  depends_on: z.array(z.string()).optional(),
  ref_sor: z.string().optional(),
  confidence: confidenceAtomSchema,
});

export const transitionAtomSchema = z.object({
  from: z.string(),
  to: z.string(),
  trigger: z.string(),
  guard: z.string().optional(),
  ref_sor: z.string().optional(),
  confidence: confidenceAtomSchema,
});

export const eventAtomSchema = z.object({
  name: z.string(),
  trigger_for: z.array(z.string()).optional(),
  confidence: confidenceAtomSchema,
});

export const decisionPhaseSchema = z.object({
  phase: z.string(),
  decision: z.string(),
  rationale: z.string().optional(),
});

export const decisionAtomSchema = z.object({
  name: z.string().optional(),
  description: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()).optional(),
  impact: z.array(z.string()).optional(),
  phases: z.array(decisionPhaseSchema).optional(),
  confidence: confidenceAtomSchema,
});

export const metricMilestoneSchema = z.object({
  date: z.string(),
  target_value: z.string(),
  label: z.string().optional(),
});

export const metricAtomSchema = z.object({
  name: z.string(),
  target: z.string(),
  threshold: z.string().optional(),
  unit: z.string().optional(),
  milestones: z.array(metricMilestoneSchema).optional(),
  confidence: confidenceAtomSchema,
});

export const roleAtomSchema = z.object({
  name: z.string(),
  kind: z
    .enum(["human", "team", "persona"])
    .catch("human") as unknown as z.ZodEnum<["human", "team", "persona"]>,
  performs: z.array(z.string()).optional(),
  description: z.string().optional(),
});

export const constraintAtomSchema = z.object({
  description: z.string(),
  severity: z
    .enum(["must", "should", "may"])
    .catch("must") as unknown as z.ZodEnum<["must", "should", "may"]>,
  metric_ref: z.string().optional(),
  confidence: confidenceAtomSchema,
});

export const boundaryAtomSchema = z.object({
  name: z.string(),
  contains: z.array(z.string()),
  excludes: z.array(z.string()).optional(),
  confidence: confidenceAtomSchema,
});

export const comparisonDimensionValueSchema = z.object({
  subject: z.string(),
  value: z.string(),
  rating: z.string().optional(),
});

export const comparisonDimensionSchema = z.object({
  dimension: z.string(),
  values: z.array(comparisonDimensionValueSchema),
});

export const comparisonAtomSchema = z.object({
  name: z.string(),
  subjects: z.array(z.string()),
  dimensions: z.array(comparisonDimensionSchema),
  conclusion: z.string().optional(),
  decision_ref: z.string().optional(),
  confidence: confidenceAtomSchema,
});

export const paragraphAtomSchema = z.object({
  entities: z.array(entityAtomSchema).optional(),
  relations: z.array(relationAtomSchema).optional(),
  behaviors: z.array(behaviorAtomSchema).optional(),
  attributes: z.array(attributeAtomSchema).optional(),
  states: z.array(stateAtomSchema).optional(),
  rules: z.array(ruleAtomSchema).optional(),
  transitions: z.array(transitionAtomSchema).optional(),
  events: z.array(eventAtomSchema).optional(),
  decisions: z.array(decisionAtomSchema).optional(),
  metrics: z.array(metricAtomSchema).optional(),
  roles: z.array(roleAtomSchema).optional(),
  constraints: z.array(constraintAtomSchema).optional(),
  comparisons: z.array(comparisonAtomSchema).optional(),
  boundaries: z.array(boundaryAtomSchema).optional(),
});

const docParagraphSchema = z.object({
  text: z.string(),
  atoms: paragraphAtomSchema,
});

export const sectionSchema = z.object({
  heading: z.string(),
  level: z.number().int().min(0).max(6),
  paragraphs: z.array(docParagraphSchema),
});

export const embeddingEntrySchema = z.object({
  sectionIndex: z.number().int(),
  paragraphIndex: z.number().int(),
  vector: z.array(z.number()),
});

export const docDigestSchema = z.object({
  version: z.literal("1"),
  sections: z.array(sectionSchema),
  embeddings: z.array(embeddingEntrySchema),
  metadata: z.object({
    sourceId: z.string(),
    hashId: z.string(),
    sourcePath: z.string(),
    contentHash: z.string(),
    chunkCount: z.number().int(),
    totalTokens: z.number().int(),
    llmCalls: z.number().int(),
    processedAt: z.string(),
  }),
});

export const docChunkParagraphSchema = z.object({
  tag: z.string().regex(/^P\d+$/),
  atoms: paragraphAtomSchema,
});

export const docChunkResultSchema = z.object({
  paragraphs: z.array(docChunkParagraphSchema),
});

export type DocDigest = z.infer<typeof docDigestSchema>;
export type DocChunkResult = z.infer<typeof docChunkResultSchema>;
