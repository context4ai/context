import { z } from "zod";
import { EdgeSource, EdgeType } from "../types/edge.js";
import { Grounding } from "../types/node.js";

export const edgeTypeSchema = z.enum(Object.values(EdgeType) as [
  EdgeType,
  ...EdgeType[],
]);

export const edgeSourceSchema = z.enum(Object.values(EdgeSource) as [
  EdgeSource,
  ...EdgeSource[],
]);

const groundingSchema = z.enum(Object.values(Grounding) as [
  Grounding,
  ...Grounding[],
]);

export const edgeSchema = z.object({
  id: z.string(),
  type: edgeTypeSchema,
  from_id: z.string(),
  to_id: z.string(),
  grounding: groundingSchema,
  source: edgeSourceSchema,
  confidence: z.number().min(0).max(1),
  valid_from: z.number().int().nullable(),
  valid_until: z.number().int().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
