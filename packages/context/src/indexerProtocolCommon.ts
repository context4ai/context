import { createHash } from "node:crypto";
import { z } from "zod";

export const INDEXER_PROVIDER_MANIFEST_NAME = "context-indexer.yaml";
export const DEFAULT_INDEXER_REGISTRY_PATH = "src/indexers.yaml";

export const INDEXER_SEMANTIC_OPERATIONS = [
  "main-index",
  "material-answer",
] as const;

export type IndexerSemanticOperation = typeof INDEXER_SEMANTIC_OPERATIONS[number];

export const INDEXER_COVERAGE_DOMAINS = [
  "technical-structure",
  "public-contract",
  "business-semantics",
  "operations",
] as const;

export type IndexerCoverageDomain = typeof INDEXER_COVERAGE_DOMAINS[number];

export const INDEXER_EVIDENCE_KINDS = [
  "code",
  "contract",
  "configuration",
  "documentation",
  "runbook",
  "decision-record",
  "test-result",
  "runtime-observation",
  "tool-snapshot",
] as const;

export type IndexerEvidenceKind = typeof INDEXER_EVIDENCE_KINDS[number];

export const INDEXER_LAYER_FRAGMENT_KINDS = [
  "fact-enrichment",
  "template-variables",
  "derived-artifact-proposal",
] as const;

export type IndexerLayerFragmentKind = typeof INDEXER_LAYER_FRAGMENT_KINDS[number];

export const INDEXER_PROGRAM_CAPABILITIES = [
  "source.read",
  "parser-facts.read",
  "indexer-result.write",
] as const;

export type IndexerProgramCapability = typeof INDEXER_PROGRAM_CAPABILITIES[number];

export const INDEXER_SUBJECT_DERIVATION_OPERATORS = [
  "canonical-source-module-namespace",
  "canonical-service-namespace",
  "canonical-module-identity",
  "canonical-export-family",
] as const;

export type IndexerSubjectDerivationOperator =
  typeof INDEXER_SUBJECT_DERIVATION_OPERATORS[number];

export const INDEXER_SUBJECT_NORMALIZATIONS = [
  "trim",
  "unicode-nfc",
  "preserve-case",
  "lowercase",
] as const;

export type IndexerSubjectNormalization =
  typeof INDEXER_SUBJECT_NORMALIZATIONS[number];

export const indexerDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const indexerIdSchema = z.string()
  .regex(/^[a-z0-9][a-z0-9._/-]*$/u)
  .superRefine((value, context) => {
    if (value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must not contain empty, current-directory, or parent-directory segments",
      });
    }
  });
export const indexerSnakeCaseIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u);
export const indexerSemverSchema = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
);
export const indexerProtocolIdSchema = z.string().regex(
  /^[a-z][a-z0-9.-]*(?:\.[a-z][a-z0-9.-]*)*\/v[1-9]\d*$/u,
);

export function isPortableIndexerPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//u.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".."
  );
}

export const portableIndexerPathSchema = z.string().superRefine((value, context) => {
  if (!isPortableIndexerPath(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "must be a portable path relative to the Provider Bundle root",
    });
  }
});

export function compareIndexerCanonicalText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareIndexerCanonicalText(left, right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalIndexerJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function indexerProtocolDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalIndexerJson(value)).digest("hex")}`;
}

export function formatIndexerSchemaIssues(issues: readonly z.ZodIssue[]): string {
  return issues.map((issue) => {
    const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
    return `${path}: ${issue.message}`;
  }).join("; ");
}

export function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  field: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} must not contain duplicate value ${value}`,
        path: [index],
      });
    }
    seen.add(value);
  });
}
