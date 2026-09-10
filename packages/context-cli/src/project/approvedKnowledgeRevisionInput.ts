import { z } from "zod";
import { indexerArtifactFactSchema, indexerEvidenceBindingSchema, indexerKnowledgeDependencyVersionSchema, indexerKnowledgeDependencySchema } from "@c4a/context";

export const approvedKnowledgeRebindingSchema = z.object({
  dependencies: z.array(indexerKnowledgeDependencySchema),
  sections: z.array(z.object({
    section_key: z.string().min(1),
    fact_refs: z.array(z.string().min(1)),
    evidence_refs: z.array(z.string().min(1)).min(1),
  }).strict()).min(1).optional(),
}).strict();
export type ApprovedKnowledgeRebinding = z.infer<typeof approvedKnowledgeRebindingSchema>;

export const approvedKnowledgeRevisionInputSchema = z.object({
  status: z.enum(["ready", "waiting"]),
  pending: z.array(z.object({ artifact_ref: z.string(), required: z.boolean(),
    reason: z.enum(["not-approved", "approval-changed", "section-unavailable", "source-version-changed", "dependency-cycle", "same-group-dependency"]) }).strict()),
  versions: z.array(indexerKnowledgeDependencyVersionSchema),
  dependency_fingerprint: z.string(),
  facts: z.array(indexerArtifactFactSchema),
  reading_sections: z.array(z.object({ artifact_ref: z.string(), section_ref: z.string(), approved_content_digest: z.string(),
    evidence_role: z.literal("approved-interpretation"), markdown: z.string(), evidence_refs: z.array(z.string()) }).strict()),
  evidence_bindings: z.array(indexerEvidenceBindingSchema),
  rebinding: approvedKnowledgeRebindingSchema.optional(),
}).strict();
export type ApprovedKnowledgeRevisionInput = z.infer<typeof approvedKnowledgeRevisionInputSchema>;
