import { createHash } from "node:crypto";
import { z } from "zod";
import { assertIndexerOutputSafe } from "../indexerOutputRedaction.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const idSchema = z.string()
  .regex(/^[a-z0-9][a-z0-9._/-]*$/u)
  .superRefine((value, context) => {
    if (value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must not contain empty, current-directory, or parent-directory segments",
      });
    }
  });
const semverSchema = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
);
const canonicalRefSchema = z.string().regex(
  /^[a-z][a-z0-9.-]*:[A-Za-z0-9][A-Za-z0-9._~:/#@+-]*$/u,
);
const packageCoordinateSchema = z.string().regex(
  /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u,
);
const portablePathSchema = z.string().superRefine((value, context) => {
  const segments = value.split("/");
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//u.test(value) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "must be a portable relative path",
    });
  }
});

function addDuplicateIssues(
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

const adapterIdentitySchema = z.object({
  id: idSchema,
  package: packageCoordinateSchema,
  export: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$.-]*$/u),
  version: semverSchema,
  digest: digestSchema,
}).strict();

const adapterLocatorSchema = z.object({
  source_ref: canonicalRefSchema,
  module_ref: canonicalRefSchema.nullable(),
  normalized_path: portablePathSchema,
  qualified_item_path: z.string().min(1).max(1024),
  signature_digest: digestSchema,
}).strict();

export const indexerEvidenceAdapterFactSchema = z.object({
  fact_ref: canonicalRefSchema,
  kind: idSchema,
  locator: adapterLocatorSchema,
  payload_digest: digestSchema,
  denominator: z.enum(["none", "eligible-file", "loc", "symbol", "protocol-item"]),
}).strict();

export const indexerEvidenceAdapterFileSchema = z.object({
  file_ref: canonicalRefSchema,
  source_ref: canonicalRefSchema,
  module_ref: canonicalRefSchema.nullable(),
  normalized_path: portablePathSchema,
  role: z.enum(["primary-owner", "enricher"]),
  coverage_tier: z.enum(["ast-catalog", "lightweight-evidence"]),
  disposition: z.enum(["analyzed", "unsupported", "excluded"]),
  facts: z.array(indexerEvidenceAdapterFactSchema),
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
  step: idSchema,
  package: packageCoordinateSchema,
  export: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$.-]*$/u),
  version: semverSchema,
  digest: digestSchema,
  capabilities: z.array(idSchema).min(1),
  input_digest: digestSchema,
  output_digest: digestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.capabilities, context, "capabilities");
});

const adapterDiagnosticSchema = z.object({
  code: idSchema,
  fact_ref: canonicalRefSchema.optional(),
  severity: z.enum(["info", "warning", "error"]),
  detail_digest: digestSchema,
}).strict();

export const indexerEvidenceAdapterResultSchema = z.object({
  protocol: z.literal("context.indexer.evidence-adapter-result/v1"),
  adapter: adapterIdentitySchema,
  authorized_scope: z.object({
    source_ref: canonicalRefSchema,
    module_refs: z.array(canonicalRefSchema),
    scope_digest: digestSchema,
  }).strict(),
  input_digest: digestSchema,
  precedence: z.number().int().nonnegative(),
  files: z.array(indexerEvidenceAdapterFileSchema).min(1),
  diagnostics: z.array(adapterDiagnosticSchema),
  toolchain: z.array(toolchainStepSchema).min(1),
  output_digest: digestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.authorized_scope.module_refs, context, "authorized_scope.module_refs");
  addDuplicateIssues(value.files.map((file) => file.file_ref), context, "files");
  addDuplicateIssues(value.toolchain.map((step) => step.step), context, "toolchain");
});

export type IndexerEvidenceAdapterResult = z.infer<
  typeof indexerEvidenceAdapterResultSchema
>;
export type IndexerEvidenceAdapterFile = z.infer<
  typeof indexerEvidenceAdapterFileSchema
>;
export type IndexerEvidenceAdapterFact = z.infer<
  typeof indexerEvidenceAdapterFactSchema
>;
export type IndexerEvidenceAdapterFactPayloadValue =
  | null
  | boolean
  | number
  | string
  | IndexerEvidenceAdapterFactPayloadValue[]
  | { [key: string]: IndexerEvidenceAdapterFactPayloadValue };

export interface IndexerEvidenceAdapterFactPayload {
  fact_ref: string;
  payload: IndexerEvidenceAdapterFactPayloadValue;
}

export interface IndexerEvidenceAdapterMaterialization {
  result: IndexerEvidenceAdapterResult;
  fact_payloads: IndexerEvidenceAdapterFactPayload[];
}

const FACT_PAYLOADS = new WeakMap<object, IndexerEvidenceAdapterFactPayloadValue>();

function canonicalFactPayload(
  value: unknown,
  seen = new WeakSet<object>(),
  path = "$",
): IndexerEvidenceAdapterFactPayloadValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Indexer Evidence Adapter fact payload numbers must be finite");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(
      `Indexer Evidence Adapter fact payload ${path} must contain only JSON values`,
    );
  }
  if (seen.has(value)) {
    throw new TypeError(`Indexer Evidence Adapter fact payload ${path} must be acyclic`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map((item, index) =>
      canonicalFactPayload(item, seen, `${path}[${index}]`)
    );
    seen.delete(value);
    return output;
  }
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    throw new TypeError(
      `Indexer Evidence Adapter fact payload ${path} must use plain JSON objects; received ${Object.prototype.toString.call(value)}`,
    );
  }
  const output: Record<string, IndexerEvidenceAdapterFactPayloadValue> = {};
  for (const [key, item] of Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  )) {
    output[key] = canonicalFactPayload(item, seen, `${path}.${key}`);
  }
  seen.delete(value);
  return output;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function indexerEvidenceAdapterProtocolDigest(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function indexerEvidenceAdapterFileRef(input: {
  source_ref: string;
  module_ref: string | null;
  normalized_path: string;
}): string {
  return `adapter-file:${indexerEvidenceAdapterProtocolDigest(input)}`;
}

export function indexerEvidenceAdapterFactRef(input: {
  source_ref: string;
  module_ref: string | null;
  normalized_path: string;
  qualified_item_path: string;
  kind: string;
  signature_digest: string;
}): string {
  return `adapter-fact:${indexerEvidenceAdapterProtocolDigest(input)}`;
}

export function createIndexerEvidenceAdapterFact(input: {
  source_ref: string;
  module_ref: string | null;
  normalized_path: string;
  qualified_item_path: string;
  kind: string;
  signature: unknown;
  payload: unknown;
  denominator: IndexerEvidenceAdapterFact["denominator"];
}): IndexerEvidenceAdapterFact {
  const payload = canonicalFactPayload(input.payload);
  const qualifiedItemPath = input.qualified_item_path.length <= 1024
    ? input.qualified_item_path
    : `${input.qualified_item_path.slice(0, 950)}#${indexerEvidenceAdapterProtocolDigest(
        input.qualified_item_path,
      )}`;
  const locator = {
    source_ref: input.source_ref,
    module_ref: input.module_ref,
    normalized_path: input.normalized_path,
    qualified_item_path: qualifiedItemPath,
    signature_digest: indexerEvidenceAdapterProtocolDigest(input.signature),
  };
  const fact: IndexerEvidenceAdapterFact = {
    fact_ref: indexerEvidenceAdapterFactRef({ ...locator, kind: input.kind }),
    kind: input.kind,
    locator,
    payload_digest: indexerEvidenceAdapterProtocolDigest(payload),
    denominator: input.denominator,
  };
  FACT_PAYLOADS.set(fact, payload);
  return fact;
}

export function indexerEvidenceAdapterFactPayloads(
  result: IndexerEvidenceAdapterResult,
): IndexerEvidenceAdapterFactPayload[] {
  const payloads = result.files.flatMap((file) => file.facts.map((fact) => {
    const payload = FACT_PAYLOADS.get(fact);
    if (payload === undefined) {
      throw new TypeError(
        `Evidence Adapter fact payload ${fact.fact_ref} is no longer materialized in this process`,
      );
    }
    if (indexerEvidenceAdapterProtocolDigest(payload) !== fact.payload_digest) {
      throw new TypeError(`Evidence Adapter fact payload ${fact.fact_ref} is stale`);
    }
    return { fact_ref: fact.fact_ref, payload };
  })).sort((left, right) => compareCanonicalText(left.fact_ref, right.fact_ref));
  return assertIndexerOutputSafe({ channel: "ipc-envelope", value: payloads });
}

/**
 * Materializes the parser fact payload sidecar while it is still available in
 * the parser process. The payloads intentionally do not survive serializing
 * the Evidence Adapter Result wire carrier.
 */
export function materializeIndexerEvidenceAdapterResult(
  result: IndexerEvidenceAdapterResult,
): IndexerEvidenceAdapterMaterialization {
  return {
    result,
    fact_payloads: indexerEvidenceAdapterFactPayloads(result),
  };
}

export function indexerEvidenceAdapterOutputDigest(
  value: Omit<IndexerEvidenceAdapterResult, "output_digest">,
): string {
  return indexerEvidenceAdapterProtocolDigest(value);
}

function compareCanonicalText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export type IndexerEvidenceAdapterResultInput = Omit<
  IndexerEvidenceAdapterResult,
  "output_digest"
>;

/**
 * Builds the parser-side wire result in the same canonical order enforced by
 * Context. Semantic ownership and cross-adapter conflicts remain a Context
 * merge concern because they require the complete eligible-file inventory.
 */
export function buildIndexerEvidenceAdapterResult(
  input: IndexerEvidenceAdapterResultInput,
): IndexerEvidenceAdapterResult {
  const canonical: IndexerEvidenceAdapterResultInput = {
    ...input,
    authorized_scope: {
      ...input.authorized_scope,
      module_refs: [...input.authorized_scope.module_refs].sort(compareCanonicalText),
    },
    files: input.files
      .map((file) => ({
        ...file,
        facts: [...file.facts].sort((left, right) =>
          compareCanonicalText(left.fact_ref, right.fact_ref)
        ),
      }))
      .sort((left, right) => compareCanonicalText(left.file_ref, right.file_ref)),
    diagnostics: [...input.diagnostics].sort((left, right) =>
      compareCanonicalText(left.fact_ref ?? "", right.fact_ref ?? "") ||
      compareCanonicalText(left.code, right.code) ||
      compareCanonicalText(left.severity, right.severity) ||
      compareCanonicalText(left.detail_digest, right.detail_digest)
    ),
    toolchain: input.toolchain.map((step) => ({
      ...step,
      capabilities: [...step.capabilities].sort(compareCanonicalText),
    })),
  };
  const payloads = new Map<string, IndexerEvidenceAdapterFactPayloadValue>();
  for (const file of canonical.files) {
    for (const fact of file.facts) {
      const payload = FACT_PAYLOADS.get(fact);
      if (payload !== undefined) payloads.set(fact.fact_ref, payload);
    }
  }
  const parsed = indexerEvidenceAdapterResultSchema.parse({
    ...canonical,
    output_digest: indexerEvidenceAdapterOutputDigest(canonical),
  });
  for (const file of parsed.files) {
    for (const fact of file.facts) {
      const payload = payloads.get(fact.fact_ref);
      if (payload !== undefined) FACT_PAYLOADS.set(fact, payload);
    }
  }
  return assertIndexerOutputSafe({ channel: "success-payload", value: parsed });
}
