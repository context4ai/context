import { z } from "zod";
import {
  FactConfidence,
  FactKind,
  FactRelation,
  FactSourceType,
  FactStatus,
} from "../types/fact.js";

export const factKindSchema = z.enum(Object.values(FactKind) as [
  FactKind,
  ...FactKind[],
]);

export const factSourceTypeSchema = z.enum(Object.values(FactSourceType) as [
  FactSourceType,
  ...FactSourceType[],
]);

export const factStatusSchema = z.enum(Object.values(FactStatus) as [
  FactStatus,
  ...FactStatus[],
]);

export const factConfidenceSchema = z.enum(Object.values(FactConfidence) as [
  FactConfidence,
  ...FactConfidence[],
]);

export const factRelationSchema = z.enum(Object.values(FactRelation) as [
  FactRelation,
  ...FactRelation[],
]);

export const sourceSpanSchema = z
  .object({
    start: z.number(),
    end: z.number(),
  })
  .nullable();

export const relatedFactSchema = z.object({
  fact_id: z.string(),
  relation: factRelationSchema,
});

export const factSchemaBase = z.object({
  id: z.string(),
  anchor_id: z.string(),
  anchor_type: z.enum(["node", "edge"]),
  kind: factKindSchema,
  content: z.string().max(256),
  detail: z.string().nullable(),
  source_type: factSourceTypeSchema,
  source_ref: z.string(),
  source_span: sourceSpanSchema,
  related_facts: z.array(relatedFactSchema).nullable(),
  valid_from: z.number().int().nullable(),
  valid_until: z.number().int().nullable(),
  status: factStatusSchema,
  confidence: factConfidenceSchema,
  workspace_id: z.string().nullable(),
  source_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const proposedFactSchema = factSchemaBase.extend({
  status: z.literal(FactStatus.Proposed),
  confidence: z.enum([
    FactConfidence.Confirmed,
    FactConfidence.Inferred,
    FactConfidence.Speculative,
  ]),
});

const activeFactSchema = factSchemaBase.extend({
  status: z.literal(FactStatus.Active),
  confidence: z.enum([
    FactConfidence.Verified,
    FactConfidence.Confirmed,
    FactConfidence.Inferred,
  ]),
});

const deprecatedFactSchema = factSchemaBase.extend({
  status: z.literal(FactStatus.Deprecated),
  confidence: z.enum([
    FactConfidence.Verified,
    FactConfidence.Confirmed,
    FactConfidence.Inferred,
  ]),
});

export const factSchema = z.union([
  proposedFactSchema,
  activeFactSchema,
  deprecatedFactSchema,
]);
