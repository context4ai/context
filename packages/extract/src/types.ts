import { EdgeSource, EdgeType, PackageKind, SymbolKind, Visibility, groundingSchema } from "@c4a/core";
import { z } from "zod";

const symbolKindSchema = z.enum(Object.values(SymbolKind) as [SymbolKind, ...SymbolKind[]]);
const visibilitySchema = z.enum(Object.values(Visibility) as [Visibility, ...Visibility[]]);
const relationTypeSchema = z.enum([
  EdgeType.Imports,
  EdgeType.ImportsType,
  EdgeType.Calls,
  EdgeType.Extends,
  EdgeType.Implements,
  EdgeType.ParamType,
  EdgeType.ReturnType,
  EdgeType.OfType,
  EdgeType.DependsOn,
  EdgeType.Contains,
]);
const relationSourceSchema = z.enum([
  EdgeSource.Ast,
  EdgeSource.Doc,
  EdgeSource.Manual,
]);
const packageKindSchema = z.enum(Object.values(PackageKind) as [PackageKind, ...PackageKind[]]);

export const symbolParamSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1).nullable(),
});

export type SymbolInfo = {
  name: string;
  kind: SymbolKind;
  visibility: Visibility;
  file: string;
  line: number;
  endLine: number;
  members?: SymbolInfo[] | undefined;
  params?: Array<{ name: string; type: string | null }> | undefined;
  returnType?: string | null | undefined;
  typeAnnotation?: string | null | undefined;
  extends?: string | null | undefined;
  implements?: string[] | undefined;
  doc?: string | null | undefined;
  propsType?: string | null | undefined;
  unionValues?: string[] | undefined;
  initializer?: string | null | undefined;
  signature?: string | null | undefined;
};

export const symbolInfoSchema: z.ZodType<SymbolInfo> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    kind: symbolKindSchema,
    visibility: visibilitySchema,
    file: z.string().min(1),
    line: z.number().int().positive(),
    endLine: z.number().int().positive(),
    members: z.array(symbolInfoSchema).optional(),
    params: z.array(symbolParamSchema).optional(),
    returnType: z.string().min(1).nullable().optional(),
    typeAnnotation: z.string().min(1).nullable().optional(),
    extends: z.string().min(1).nullable().optional(),
    implements: z.array(z.string().min(1)).optional(),
    doc: z.string().nullable().optional(),
    propsType: z.string().min(1).nullable().optional(),
    unionValues: z.array(z.string()).optional(),
    initializer: z.string().min(1).nullable().optional(),
    signature: z.string().min(1).nullable().optional(),
  })
);

export const relationInfoSchema = z.object({
  type: relationTypeSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  isExternal: z.boolean(),
  grounding: groundingSchema,
  confidence: z.number().min(0).max(1),
  source: relationSourceSchema,
  line: z.number().int().positive().optional(),
});

export const fileInfoSchema = z.object({
  path: z.string().min(1),
  language: z.string().min(1),
  lines: z.number().int().nonnegative(),
});

export const extractionDiagnosticSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  file: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

export const extractionCoverageSchema = z.object({
  tier: z.enum(["ast-catalog", "lightweight-evidence"]),
  capabilities: z.array(z.string().min(1)),
  files: z.array(z.object({
    path: z.string().min(1),
    disposition: z.enum(["analyzed", "unsupported", "excluded"]),
    diagnosticCodes: z.array(z.string().min(1)),
  })),
  diagnostics: z.array(extractionDiagnosticSchema),
});

export const extractionMetaSchema = z.object({
  extractedAt: z.string().datetime(),
  pluginId: z.string().min(1),
  commitHash: z.string().min(1).nullable(),
  language: z.string().min(1),
});

export const extractionPackageSchema = z.object({
  name: z.string().min(1),
  kind: packageKindSchema,
  language: z.string().min(1),
  version: z.string().min(1).optional(),
});

export const extractionStatsSchema = z.object({
  files: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  exportedSymbols: z.number().int().nonnegative(),
  internalSymbols: z.number().int().nonnegative(),
  relations: z.number().int().nonnegative(),
});

export const extractionResultSchema = z.object({
  version: z.literal("2"),
  meta: extractionMetaSchema,
  package: extractionPackageSchema,
  files: z.array(fileInfoSchema),
  symbols: z.array(symbolInfoSchema),
  relations: z.array(relationInfoSchema),
  coverage: extractionCoverageSchema.optional(),
  stats: extractionStatsSchema,
});

export const digestStatsSchema = z.object({
  files: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  exported_count: z.number().int().nonnegative(),
  internal_count: z.number().int().nonnegative(),
  relations: z.number().int().nonnegative(),
});

export const digestDataSchema = z.object({
  version: z.literal("2"),
  meta: extractionMetaSchema,
  package: extractionPackageSchema,
  files: z.array(fileInfoSchema),
  symbols: z.array(symbolInfoSchema),
  relations: z.array(relationInfoSchema),
  coverage: extractionCoverageSchema.optional(),
  stats: digestStatsSchema,
});

export const symbolDiffSchema = z.object({
  added: z.array(z.string().min(1)),
  removed: z.array(z.string().min(1)),
});

export type RelationInfo = z.infer<typeof relationInfoSchema>;
export type FileInfo = z.infer<typeof fileInfoSchema>;
export type ExtractionMeta = z.infer<typeof extractionMetaSchema>;
export type ExtractionPackageInfo = z.infer<typeof extractionPackageSchema>;
export type ExtractionStats = z.infer<typeof extractionStatsSchema>;
export type ExtractionDiagnostic = z.infer<typeof extractionDiagnosticSchema>;
export type ExtractionCoverage = z.infer<typeof extractionCoverageSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type DigestData = z.infer<typeof digestDataSchema>;
export type SymbolDiff = z.infer<typeof symbolDiffSchema>;
