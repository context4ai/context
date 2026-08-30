import { z } from "zod";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  formatIndexerSchemaIssues,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";

const packageCoordinateSchema = z.string().regex(
  /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u,
);

const adapterIdentitySchema = z.object({
  id: indexerIdSchema,
  package: packageCoordinateSchema,
  export: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$.-]*$/u),
  version: indexerSemverSchema,
  digest: indexerDigestSchema,
}).strict();

const adapterLocatorSchema = z.object({
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  normalized_path: portableIndexerPathSchema,
  qualified_item_path: z.string().min(1).max(1024),
  signature_digest: indexerDigestSchema,
}).strict();

const adapterFactSchema = z.object({
  fact_ref: indexerCanonicalRefSchema,
  kind: indexerIdSchema,
  locator: adapterLocatorSchema,
  payload_digest: indexerDigestSchema,
  denominator: z.enum(["none", "eligible-file", "loc", "symbol", "protocol-item"]),
}).strict();

const adapterFileSchema = z.object({
  file_ref: indexerCanonicalRefSchema,
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  normalized_path: portableIndexerPathSchema,
  role: z.enum(["primary-owner", "enricher"]),
  coverage_tier: z.enum(["ast-catalog", "lightweight-evidence"]),
  disposition: z.enum(["analyzed", "unsupported", "excluded"]),
  facts: z.array(adapterFactSchema),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.facts.map((fact) => fact.fact_ref), context, "facts");
  if (value.disposition !== "analyzed" && value.facts.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "unsupported or excluded files cannot publish facts",
      path: ["facts"],
    });
  }
  if (
    (value.role === "enricher" || value.coverage_tier === "lightweight-evidence") &&
    value.facts.some((fact) => fact.denominator !== "none")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "enricher and lightweight evidence facts cannot contribute denominators",
      path: ["facts"],
    });
  }
});

const toolchainStepSchema = z.object({
  step: indexerIdSchema,
  package: packageCoordinateSchema,
  export: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$.-]*$/u),
  version: indexerSemverSchema,
  digest: indexerDigestSchema,
  capabilities: z.array(indexerIdSchema).min(1),
  input_digest: indexerDigestSchema,
  output_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.capabilities, context, "capabilities");
});

const adapterDiagnosticSchema = z.object({
  code: indexerIdSchema,
  fact_ref: indexerCanonicalRefSchema.optional(),
  severity: z.enum(["info", "warning", "error"]),
  detail_digest: indexerDigestSchema,
}).strict();

export const indexerEvidenceAdapterResultSchema = z.object({
  protocol: z.literal("context.indexer.evidence-adapter-result/v1"),
  adapter: adapterIdentitySchema,
  authorized_scope: z.object({
    source_ref: indexerCanonicalRefSchema,
    module_refs: z.array(indexerCanonicalRefSchema),
    scope_digest: indexerDigestSchema,
  }).strict(),
  input_digest: indexerDigestSchema,
  precedence: z.number().int().nonnegative(),
  files: z.array(adapterFileSchema).min(1),
  diagnostics: z.array(adapterDiagnosticSchema),
  toolchain: z.array(toolchainStepSchema).min(1),
  output_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.authorized_scope.module_refs, context, "authorized_scope.module_refs");
  addDuplicateIssues(value.files.map((file) => file.file_ref), context, "files");
  addDuplicateIssues(value.toolchain.map((step) => step.step), context, "toolchain");
});

export type IndexerEvidenceAdapterResult = z.infer<
  typeof indexerEvidenceAdapterResultSchema
>;
export type IndexerEvidenceAdapterFile = IndexerEvidenceAdapterResult["files"][number];
export type IndexerEvidenceAdapterFact = IndexerEvidenceAdapterFile["facts"][number];

function withoutOutputDigest(
  value: IndexerEvidenceAdapterResult,
): Omit<IndexerEvidenceAdapterResult, "output_digest"> {
  const payload: Partial<IndexerEvidenceAdapterResult> = { ...value };
  Reflect.deleteProperty(payload, "output_digest");
  return payload as Omit<IndexerEvidenceAdapterResult, "output_digest">;
}

export function indexerEvidenceAdapterFileRef(input: {
  source_ref: string;
  module_ref: string | null;
  normalized_path: string;
}): string {
  return `adapter-file:${indexerProtocolDigest(input)}`;
}

export function indexerEvidenceAdapterFactRef(input: {
  source_ref: string;
  module_ref: string | null;
  normalized_path: string;
  qualified_item_path: string;
  kind: string;
  signature_digest: string;
}): string {
  return `adapter-fact:${indexerProtocolDigest(input)}`;
}

export function indexerEvidenceAdapterOutputDigest(
  value: Omit<IndexerEvidenceAdapterResult, "output_digest">,
): string {
  return indexerProtocolDigest(value);
}

function assertCanonicalOrder(values: readonly string[], field: string): void {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (values.some((value, index) => value !== sorted[index])) {
    throw new TypeError(`${field} must use canonical order`);
  }
}

export function validateIndexerEvidenceAdapterResult(
  value: unknown,
): IndexerEvidenceAdapterResult {
  const parsed = indexerEvidenceAdapterResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `Evidence Adapter Result is invalid: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  const result = parsed.data;
  assertCanonicalOrder(result.authorized_scope.module_refs, "authorized_scope.module_refs");
  assertCanonicalOrder(result.files.map((file) => file.file_ref), "files");
  if (result.toolchain[0]!.input_digest !== result.input_digest) {
    throw new TypeError("toolchain must start from the Result input digest");
  }
  result.toolchain.slice(1).forEach((step, index) => {
    if (step.input_digest !== result.toolchain[index]!.output_digest) {
      throw new TypeError("toolchain input/output digests must form one ordered chain");
    }
  });
  const allowedModules = new Set(result.authorized_scope.module_refs);
  for (const file of result.files) {
    if (
      file.source_ref !== result.authorized_scope.source_ref ||
      (file.module_ref !== null && !allowedModules.has(file.module_ref))
    ) {
      throw new TypeError(`adapter file ${file.file_ref} escapes its authorized scope`);
    }
    if (file.file_ref !== indexerEvidenceAdapterFileRef({
      source_ref: file.source_ref,
      module_ref: file.module_ref,
      normalized_path: file.normalized_path,
    })) {
      throw new TypeError(`adapter file ${file.file_ref} has a non-canonical identity`);
    }
    assertCanonicalOrder(file.facts.map((fact) => fact.fact_ref), `${file.file_ref}.facts`);
    for (const fact of file.facts) {
      if (
        fact.locator.source_ref !== file.source_ref ||
        fact.locator.module_ref !== file.module_ref ||
        fact.locator.normalized_path !== file.normalized_path
      ) {
        throw new TypeError(`adapter fact ${fact.fact_ref} locator escapes its file identity`);
      }
      if (fact.fact_ref !== indexerEvidenceAdapterFactRef({
        ...fact.locator,
        kind: fact.kind,
      })) {
        throw new TypeError(`adapter fact ${fact.fact_ref} has a non-canonical identity`);
      }
    }
  }
  if (indexerEvidenceAdapterOutputDigest(withoutOutputDigest(result)) !== result.output_digest) {
    throw new TypeError("Evidence Adapter Result output digest does not match its payload");
  }
  return result;
}

export interface IndexerEvidenceAdapterMerge {
  protocol: "context.indexer.evidence-adapter-merge/v1";
  result_digests: string[];
  primary_owners: Array<{ file_ref: string; adapter_id: string; coverage_tier: string }>;
  facts: Array<IndexerEvidenceAdapterFact & { adapter_id: string; precedence: number }>;
  conflicts: Array<{
    fact_ref: string;
    winner_adapter_id: string;
    shadowed_adapter_ids: string[];
  }>;
  merge_digest: string;
}

function mergeDigest(value: Omit<IndexerEvidenceAdapterMerge, "merge_digest">): string {
  return indexerProtocolDigest(value);
}

export function mergeIndexerEvidenceAdapterResults(input: {
  results: readonly unknown[];
  eligible_file_refs: readonly string[];
}): IndexerEvidenceAdapterMerge {
  const results = input.results.map(validateIndexerEvidenceAdapterResult);
  const resultDigests = results.map((result) => result.output_digest)
    .sort(compareIndexerCanonicalText);
  if (new Set(resultDigests).size !== resultDigests.length) {
    throw new TypeError("Evidence Adapter Results must be unique by output digest");
  }
  const eligible = new Set(input.eligible_file_refs);
  if (eligible.size !== input.eligible_file_refs.length) {
    throw new TypeError("eligible file refs must be unique");
  }
  const owners = new Map<string, Array<{ adapter_id: string; coverage_tier: string }>>();
  const factCandidates = new Map<
    string,
    Array<{ fact: IndexerEvidenceAdapterFact; adapter_id: string; precedence: number }>
  >();
  for (const result of results) {
    for (const file of result.files) {
      if (!eligible.has(file.file_ref)) {
        throw new TypeError(`adapter Result includes unknown eligible file ${file.file_ref}`);
      }
      if (file.role === "primary-owner") {
        owners.set(file.file_ref, [
          ...(owners.get(file.file_ref) ?? []),
          { adapter_id: result.adapter.id, coverage_tier: file.coverage_tier },
        ]);
      }
      for (const fact of file.facts) {
        factCandidates.set(fact.fact_ref, [
          ...(factCandidates.get(fact.fact_ref) ?? []),
          { fact, adapter_id: result.adapter.id, precedence: result.precedence },
        ]);
      }
    }
  }
  const primaryOwners = [...eligible].sort(compareIndexerCanonicalText).map((fileRef) => {
    const candidates = owners.get(fileRef) ?? [];
    if (candidates.length !== 1) {
      throw new TypeError(`eligible file ${fileRef} must have exactly one primary owner`);
    }
    return { file_ref: fileRef, ...candidates[0]! };
  });
  const facts: IndexerEvidenceAdapterMerge["facts"] = [];
  const conflicts: IndexerEvidenceAdapterMerge["conflicts"] = [];
  for (const factRef of [...factCandidates.keys()].sort(compareIndexerCanonicalText)) {
    const candidates = factCandidates.get(factRef)!.sort((left, right) =>
      right.precedence - left.precedence ||
      compareIndexerCanonicalText(left.adapter_id, right.adapter_id)
    );
    if (new Set(candidates.map((candidate) => candidate.fact.denominator)).size > 1) {
      throw new TypeError(`adapter fact ${factRef} has conflicting denominator authority`);
    }
    const bestPrecedence = candidates[0]!.precedence;
    const best = candidates.filter((candidate) => candidate.precedence === bestPrecedence);
    const payloads = new Set(best.map((candidate) => indexerProtocolDigest(candidate.fact)));
    if (payloads.size > 1) {
      throw new TypeError(`adapter fact ${factRef} has an equal-precedence conflict`);
    }
    const winner = best[0]!;
    facts.push({ ...winner.fact, adapter_id: winner.adapter_id, precedence: winner.precedence });
    const shadowed = candidates.filter((candidate) => candidate !== winner)
      .map((candidate) => candidate.adapter_id)
      .sort(compareIndexerCanonicalText);
    if (shadowed.length > 0) {
      conflicts.push({
        fact_ref: factRef,
        winner_adapter_id: winner.adapter_id,
        shadowed_adapter_ids: shadowed,
      });
    }
  }
  const payload: Omit<IndexerEvidenceAdapterMerge, "merge_digest"> = {
    protocol: "context.indexer.evidence-adapter-merge/v1",
    result_digests: resultDigests,
    primary_owners: primaryOwners,
    facts,
    conflicts,
  };
  return { ...payload, merge_digest: mergeDigest(payload) };
}
