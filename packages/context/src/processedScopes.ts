import { z } from "zod";

const reference = z.string().min(1).refine((value) => value.trim() === value, {
  message: "scope references must not have surrounding whitespace",
});

/** The latest completed input for one requirement and source scope, not a
 * page revision or an acquisition receipt. An absent module list means the
 * whole source within that requirement. */
export const processedScopeSchema = z.object({
  requirement_ref: reference,
  source_ref: reference,
  processed_version: reference,
  module_refs: z.array(reference).min(1).optional(),
}).strict().superRefine((scope, context) => {
  if (scope.module_refs && new Set(scope.module_refs).size !== scope.module_refs.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["module_refs"],
      message: "module_refs must not contain duplicates" });
  }
});

export type ProcessedScope = z.infer<typeof processedScopeSchema>;

export function processedScopeKey(scope: Pick<ProcessedScope,
  "requirement_ref" | "source_ref" | "module_refs">): string {
  return JSON.stringify([scope.requirement_ref, scope.source_ref,
    [...(scope.module_refs ?? [])].sort()]);
}

export const processedScopesSchema = z.array(processedScopeSchema).superRefine((scopes, context) => {
  const seen = new Set<string>();
  scopes.forEach((scope, index) => {
    const key = processedScopeKey(scope);
    if (seen.has(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [index],
        message: "processed_scopes must contain only one latest version per exact scope" });
    }
    seen.add(key);
  });
});

/** Missing metadata is unknown, never inferred from current source versions. */
export function readProcessedScopes(structure: Record<string, unknown> | null): ProcessedScope[] {
  return processedScopesSchema.parse(structure?.processed_scopes === undefined
    ? [] : structure.processed_scopes);
}

function containsScope(outer: ProcessedScope, inner: Pick<ProcessedScope, "requirement_ref" | "source_ref" | "module_refs">): boolean {
  return outer.requirement_ref === inner.requirement_ref && outer.source_ref === inner.source_ref &&
    (outer.module_refs === undefined || (inner.module_refs !== undefined &&
      inner.module_refs.every((module) => outer.module_refs!.includes(module))));
}

/** A narrower completed scope cannot advance its containing source scope. */
export function mergeProcessedScopes(previous: readonly ProcessedScope[], completed: readonly ProcessedScope[]): ProcessedScope[] {
  const updates = processedScopesSchema.parse(completed);
  const retained = processedScopesSchema.parse(previous).filter((scope) =>
    !updates.some((update) => containsScope(update, scope)));
  return [...retained, ...updates].sort((a, b) => processedScopeKey(a).localeCompare(processedScopeKey(b)));
}

/** Overlapping incomparable scopes with different versions are unknown; string
 * ordering of commit hashes is never a chronology. */
export function processedVersionForScope(scopes: readonly ProcessedScope[], scope: Pick<ProcessedScope,
  "requirement_ref" | "source_ref" | "module_refs">): string | undefined {
  const parsed = processedScopesSchema.parse(scopes);
  const exact = parsed.find((entry) => processedScopeKey(entry) === processedScopeKey(scope));
  if (exact) return exact.processed_version;
  const versions = new Set(parsed.filter((entry) => containsScope(entry, scope)).map((entry) => entry.processed_version));
  return versions.size === 1 ? [...versions][0] : undefined;
}
