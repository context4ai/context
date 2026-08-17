import { z } from "zod";
import {
  Grounding,
  NodeType,
  PackageKind,
  ProductKind,
  SymbolKind,
  Visibility,
} from "../types/node.js";

export const nodeTypeSchema = z.enum(Object.values(NodeType) as [
  NodeType,
  ...NodeType[],
]);

export const productKindSchema = z.enum(Object.values(ProductKind) as [
  ProductKind,
  ...ProductKind[],
]);

export const packageKindSchema = z.enum(Object.values(PackageKind) as [
  PackageKind,
  ...PackageKind[],
]);

export const symbolKindSchema = z.enum(Object.values(SymbolKind) as [
  SymbolKind,
  ...SymbolKind[],
]);

export const groundingSchema = z.enum(Object.values(Grounding) as [
  Grounding,
  ...Grounding[],
]);

export const visibilitySchema = z.enum(Object.values(Visibility) as [
  Visibility,
  ...Visibility[],
]);

const nodeBaseSchema = z.object({
  id: z.string(),
  grounding: groundingSchema,
  name: z.string(),
  language: z.string().nullable(),
  visibility: visibilitySchema.nullable(),
  source_id: z.string().nullable(),
  valid_from: z.number().int().nullable(),
  valid_until: z.number().int().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const productNodeSchema = nodeBaseSchema.extend({
  type: z.literal(NodeType.Product),
  kind: productKindSchema,
});

const packageNodeSchema = nodeBaseSchema.extend({
  type: z.literal(NodeType.Package),
  kind: packageKindSchema,
});

const symbolNodeSchema = nodeBaseSchema.extend({
  type: z.literal(NodeType.Symbol),
  kind: symbolKindSchema,
});

export const nodeSchema = z.discriminatedUnion("type", [
  productNodeSchema,
  packageNodeSchema,
  symbolNodeSchema,
]);
