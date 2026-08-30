import { z } from "zod";
import {
  indexerEvidenceAdapterFactRef,
  indexerEvidenceAdapterFileRef,
  validateIndexerEvidenceAdapterResult,
  type IndexerEvidenceAdapterFact,
  type IndexerEvidenceAdapterFile,
} from "./indexerEvidenceAdapterResult.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  addDuplicateIssues,
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";
import type { IndexerJson } from "./indexerRegistry.js";

const canonicalJsonSchema: z.ZodType<IndexerJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(canonicalJsonSchema),
    z.record(canonicalJsonSchema),
  ])
);

const parserFactSchema = z.object({
  fact_ref: indexerCanonicalRefSchema,
  kind: indexerIdSchema,
  locator: z.object({
    source_ref: indexerCanonicalRefSchema,
    module_ref: indexerCanonicalRefSchema.nullable(),
    normalized_path: portableIndexerPathSchema,
    qualified_item_path: z.string().min(1).max(1024),
    signature_digest: indexerDigestSchema,
  }).strict(),
  payload: canonicalJsonSchema,
  payload_digest: indexerDigestSchema,
  denominator: z.enum(["none", "eligible-file", "loc", "symbol", "protocol-item"]),
}).strict();

const parserFactFileSchema = z.object({
  file_ref: indexerCanonicalRefSchema,
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  normalized_path: portableIndexerPathSchema,
  disposition: z.enum(["analyzed", "unsupported", "excluded"]),
  facts: z.array(parserFactSchema),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.facts.map((fact) => fact.fact_ref), context, "facts");
  if (value.disposition !== "analyzed" && value.facts.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "only analyzed parser files can expose fact payloads",
      path: ["facts"],
    });
  }
});

export const indexerParserFactViewSchema = z.object({
  protocol: z.literal("context.indexer.parser-fact-view/v1"),
  authorized_scope: z.object({
    source_ref: indexerCanonicalRefSchema,
    module_refs: z.array(indexerCanonicalRefSchema),
    scope_digest: indexerDigestSchema,
  }).strict(),
  inventory_digest: indexerDigestSchema,
  origin_result_digests: z.array(indexerDigestSchema).min(1),
  files: z.array(parserFactFileSchema).min(1),
  fact_set_digest: indexerDigestSchema,
  view_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.authorized_scope.module_refs, context, "authorized_scope.module_refs");
  addDuplicateIssues(value.origin_result_digests, context, "origin_result_digests");
  addDuplicateIssues(value.files.map((file) => file.file_ref), context, "files");
});

export type IndexerParserFact = z.infer<typeof parserFactSchema>;
export type IndexerParserFactFile = z.infer<typeof parserFactFileSchema>;
export type IndexerParserFactView = z.infer<typeof indexerParserFactViewSchema>;

export interface IndexerParserFactPayload {
  fact_ref: string;
  payload: IndexerJson;
}

function canonicalUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must contain unique values`);
  }
  return sorted;
}

function factSetPayload(value: Pick<IndexerParserFactView, "files">): unknown {
  return value.files.map((file) => ({
    file_ref: file.file_ref,
    facts: file.facts,
  }));
}

function viewPayload(
  value: IndexerParserFactView,
): Omit<IndexerParserFactView, "view_digest"> {
  return {
    protocol: value.protocol,
    authorized_scope: value.authorized_scope,
    inventory_digest: value.inventory_digest,
    origin_result_digests: value.origin_result_digests,
    files: value.files,
    fact_set_digest: value.fact_set_digest,
  };
}

function assertCanonicalOrder(values: readonly string[], field: string): void {
  const expected = [...values].sort(compareIndexerCanonicalText);
  if (values.some((value, index) => value !== expected[index])) {
    throw new TypeError(`${field} must use canonical order`);
  }
}

export function validateIndexerParserFactView(value: unknown): IndexerParserFactView {
  const view = indexerParserFactViewSchema.parse(value);
  assertCanonicalOrder(view.authorized_scope.module_refs, "authorized_scope.module_refs");
  assertCanonicalOrder(view.origin_result_digests, "origin_result_digests");
  assertCanonicalOrder(view.files.map((file) => file.file_ref), "parser fact files");
  const scopePayload = {
    source_ref: view.authorized_scope.source_ref,
    module_refs: view.authorized_scope.module_refs,
  };
  if (indexerProtocolDigest(scopePayload) !== view.authorized_scope.scope_digest) {
    throw new TypeError("parser fact view scope digest is invalid");
  }
  const allowedModules = new Set(view.authorized_scope.module_refs);
  for (const file of view.files) {
    if (
      file.source_ref !== view.authorized_scope.source_ref ||
      (file.module_ref !== null && !allowedModules.has(file.module_ref)) ||
      file.file_ref !== indexerEvidenceAdapterFileRef({
        source_ref: file.source_ref,
        module_ref: file.module_ref,
        normalized_path: file.normalized_path,
      })
    ) {
      throw new TypeError(`parser fact file ${file.file_ref} escapes its authorized scope`);
    }
    assertCanonicalOrder(file.facts.map((fact) => fact.fact_ref), `${file.file_ref}.facts`);
    for (const fact of file.facts) {
      if (
        fact.locator.source_ref !== file.source_ref ||
        fact.locator.module_ref !== file.module_ref ||
        fact.locator.normalized_path !== file.normalized_path ||
        fact.fact_ref !== indexerEvidenceAdapterFactRef({ ...fact.locator, kind: fact.kind })
      ) {
        throw new TypeError(`parser fact ${fact.fact_ref} has a non-canonical locator`);
      }
      if (indexerProtocolDigest(fact.payload) !== fact.payload_digest) {
        throw new TypeError(`parser fact ${fact.fact_ref} payload digest is invalid`);
      }
    }
  }
  if (indexerProtocolDigest(factSetPayload(view)) !== view.fact_set_digest) {
    throw new TypeError("parser fact set digest is invalid");
  }
  if (indexerProtocolDigest(viewPayload(view)) !== view.view_digest) {
    throw new TypeError("parser fact view digest is invalid");
  }
  return view;
}

interface MergedFile {
  descriptor: Omit<IndexerEvidenceAdapterFile, "role" | "coverage_tier" | "facts">;
  dispositions: Set<IndexerEvidenceAdapterFile["disposition"]>;
  facts: Map<string, IndexerEvidenceAdapterFact>;
}

function mergedDisposition(
  dispositions: ReadonlySet<IndexerEvidenceAdapterFile["disposition"]>,
): IndexerParserFactFile["disposition"] {
  if (dispositions.has("analyzed")) return "analyzed";
  if (dispositions.has("unsupported")) return "unsupported";
  return "excluded";
}

export function buildIndexerParserFactView(input: {
  adapter_results: readonly unknown[];
  fact_payloads: readonly IndexerParserFactPayload[];
  inventory_digest: string;
  file_refs?: readonly string[];
}): IndexerParserFactView {
  if (input.adapter_results.length === 0) {
    throw new TypeError("parser fact view requires at least one Evidence Adapter Result");
  }
  const results = input.adapter_results.map(validateIndexerEvidenceAdapterResult);
  const scope = results[0]!.authorized_scope;
  for (const result of results.slice(1)) {
    if (canonicalIndexerJson(result.authorized_scope) !== canonicalIndexerJson(scope)) {
      throw new TypeError("parser fact view cannot combine different authorized scopes");
    }
  }
  const payloads = new Map<string, IndexerJson>();
  for (const item of input.fact_payloads) {
    const factRef = indexerCanonicalRefSchema.parse(item.fact_ref);
    if (payloads.has(factRef)) throw new TypeError(`duplicate parser fact payload ${factRef}`);
    payloads.set(factRef, canonicalJsonSchema.parse(item.payload));
  }
  const merged = new Map<string, MergedFile>();
  for (const result of results) {
    for (const file of result.files) {
      const descriptor = {
        file_ref: file.file_ref,
        source_ref: file.source_ref,
        module_ref: file.module_ref,
        normalized_path: file.normalized_path,
        disposition: file.disposition,
      };
      const current = merged.get(file.file_ref);
      if (current !== undefined && (
        current.descriptor.source_ref !== descriptor.source_ref ||
        current.descriptor.module_ref !== descriptor.module_ref ||
        current.descriptor.normalized_path !== descriptor.normalized_path
      )) {
        throw new TypeError(`parser fact file ${file.file_ref} has conflicting identities`);
      }
      const target = current ?? {
        descriptor,
        dispositions: new Set<IndexerEvidenceAdapterFile["disposition"]>(),
        facts: new Map<string, IndexerEvidenceAdapterFact>(),
      };
      target.dispositions.add(file.disposition);
      for (const fact of file.facts) {
        const previous = target.facts.get(fact.fact_ref);
        if (previous !== undefined && canonicalIndexerJson(previous) !== canonicalIndexerJson(fact)) {
          throw new TypeError(`parser fact ${fact.fact_ref} has conflicting descriptors`);
        }
        target.facts.set(fact.fact_ref, fact);
      }
      merged.set(file.file_ref, target);
    }
  }
  const selectedRefs = input.file_refs === undefined
    ? [...merged.keys()].sort(compareIndexerCanonicalText)
    : canonicalUnique(input.file_refs, "parser fact view file_refs");
  const expectedPayloadRefs = new Set<string>();
  const files = selectedRefs.map((fileRef): IndexerParserFactFile => {
    const file = merged.get(fileRef);
    if (file === undefined) throw new TypeError(`parser fact view references unknown file ${fileRef}`);
    const disposition = mergedDisposition(file.dispositions);
    const facts = disposition === "analyzed"
      ? [...file.facts.values()].sort((left, right) =>
        compareIndexerCanonicalText(left.fact_ref, right.fact_ref)
      ).map((fact): IndexerParserFact => {
        const payload = payloads.get(fact.fact_ref);
        if (payload === undefined) {
          throw new TypeError(`parser fact payload is unavailable for ${fact.fact_ref}`);
        }
        if (indexerProtocolDigest(payload) !== fact.payload_digest) {
          throw new TypeError(`parser fact payload does not match ${fact.fact_ref}`);
        }
        expectedPayloadRefs.add(fact.fact_ref);
        return { ...fact, payload };
      })
      : [];
    return {
      file_ref: file.descriptor.file_ref,
      source_ref: file.descriptor.source_ref,
      module_ref: file.descriptor.module_ref,
      normalized_path: file.descriptor.normalized_path,
      disposition,
      facts,
    };
  });
  const extraPayload = [...payloads.keys()].find((factRef) => !expectedPayloadRefs.has(factRef));
  if (extraPayload !== undefined) {
    throw new TypeError(`parser fact payload ${extraPayload} is outside the selected view`);
  }
  const base = {
    protocol: "context.indexer.parser-fact-view/v1" as const,
    authorized_scope: scope,
    inventory_digest: indexerDigestSchema.parse(input.inventory_digest),
    origin_result_digests: canonicalUnique(
      results.map((result) => result.output_digest),
      "parser fact origin results",
    ),
    files,
  };
  const withFactDigest = {
    ...base,
    fact_set_digest: indexerProtocolDigest(factSetPayload(base)),
  };
  return validateIndexerParserFactView({
    ...withFactDigest,
    view_digest: indexerProtocolDigest(withFactDigest),
  });
}

export function buildIndexerParserFactViewFromMaterializations(input: {
  materializations: readonly {
    result: unknown;
    fact_payloads: readonly IndexerParserFactPayload[];
  }[];
  inventory_digest: string;
  file_refs?: readonly string[];
}): IndexerParserFactView {
  return buildIndexerParserFactView({
    adapter_results: input.materializations.map((item) => item.result),
    fact_payloads: input.materializations.flatMap((item) => item.fact_payloads),
    inventory_digest: input.inventory_digest,
    ...(input.file_refs === undefined ? {} : { file_refs: input.file_refs }),
  });
}
