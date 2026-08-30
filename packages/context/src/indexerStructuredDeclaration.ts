import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  validateIndexerEvidenceAdapterResult,
  type IndexerEvidenceAdapterFact,
} from "./indexerEvidenceAdapterResult.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

export const INDEXER_STRUCTURED_DECLARATION_CARRIER_KINDS = [
  "indexer-result",
  "catalog",
  "manifest",
  "section-evidence",
] as const;

export const INDEXER_STRUCTURED_DECLARATION_KINDS = [
  "directory",
  "entry",
  "method",
  "handler",
  "store",
  "locator",
] as const;

const sourceIdentityFactSchema = z.object({
  fact_ref: indexerCanonicalRefSchema,
  fact_kind: indexerIdSchema,
  qualified_item_path: z.string().min(1).max(1024),
  signature_digest: indexerDigestSchema,
}).strict();

const sourceIdentityFileSchema = z.object({
  normalized_path: portableIndexerPathSchema,
  content_digest: indexerDigestSchema,
  facts: z.array(sourceIdentityFactSchema),
}).strict();

export const indexerSourceIdentityInventorySchema = z.object({
  protocol: z.literal("context.indexer.source-identity-inventory/v1"),
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  source_input_digest: indexerDigestSchema,
  files: z.array(sourceIdentityFileSchema).min(1),
  inventory_digest: indexerDigestSchema,
}).strict();

export type IndexerSourceIdentityFact = z.infer<typeof sourceIdentityFactSchema>;
export type IndexerSourceIdentityFile = z.infer<typeof sourceIdentityFileSchema>;
export type IndexerSourceIdentityInventory = z.infer<
  typeof indexerSourceIdentityInventorySchema
>;

function canonicalUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must contain unique identities`);
  }
  return sorted;
}

function canonicalSourceFiles(
  values: readonly IndexerSourceIdentityFile[],
): IndexerSourceIdentityFile[] {
  const files = values.map((value) => {
    const file = sourceIdentityFileSchema.parse(value);
    const facts = [...file.facts].sort((left, right) =>
      compareIndexerCanonicalText(left.fact_ref, right.fact_ref)
    );
    canonicalUnique(facts.map((fact) => fact.fact_ref), `${file.normalized_path}.facts`);
    return { ...file, facts };
  }).sort((left, right) =>
    compareIndexerCanonicalText(left.normalized_path, right.normalized_path)
  );
  canonicalUnique(files.map((file) => file.normalized_path), "source identity files");
  const allFactRefs = files.flatMap((file) => file.facts.map((fact) => fact.fact_ref));
  canonicalUnique(allFactRefs, "source identity facts");
  return files;
}

export function indexerSourceIdentityInventoryDigest(
  value: Omit<IndexerSourceIdentityInventory, "inventory_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerSourceIdentityInventory(input: {
  source_ref: string;
  module_ref: string | null;
  source_input_digest: string;
  files: readonly IndexerSourceIdentityFile[];
}): IndexerSourceIdentityInventory {
  const payload: Omit<IndexerSourceIdentityInventory, "inventory_digest"> = {
    protocol: "context.indexer.source-identity-inventory/v1",
    source_ref: indexerCanonicalRefSchema.parse(input.source_ref),
    module_ref: indexerCanonicalRefSchema.nullable().parse(input.module_ref),
    source_input_digest: indexerDigestSchema.parse(input.source_input_digest),
    files: canonicalSourceFiles(input.files),
  };
  return indexerSourceIdentityInventorySchema.parse({
    ...payload,
    inventory_digest: indexerSourceIdentityInventoryDigest(payload),
  });
}

export function validateIndexerSourceIdentityInventory(
  value: unknown,
): IndexerSourceIdentityInventory {
  const parsed = indexerSourceIdentityInventorySchema.parse(value);
  const rebuilt = buildIndexerSourceIdentityInventory(parsed);
  if (canonicalIndexerJson(parsed) !== canonicalIndexerJson(rebuilt)) {
    throw new TypeError("source identity inventory is non-canonical or invalid");
  }
  return parsed;
}

interface AdapterSourceFileAccumulator {
  content_digest: string;
  primary_owner_count: number;
  facts: Map<string, IndexerSourceIdentityFact>;
}

function sourceIdentityFact(
  fact: IndexerEvidenceAdapterFact,
): IndexerSourceIdentityFact {
  return {
    fact_ref: fact.fact_ref,
    fact_kind: fact.kind,
    qualified_item_path: fact.locator.qualified_item_path,
    signature_digest: fact.locator.signature_digest,
  };
}

export function buildIndexerSourceIdentityInventoryFromAdapterResults(input: {
  source_ref: string;
  module_ref: string | null;
  source_input_digest: string;
  file_content_digests: Readonly<Record<string, string>>;
  results: readonly unknown[];
}): IndexerSourceIdentityInventory {
  const files = new Map<string, AdapterSourceFileAccumulator>();
  for (const candidate of input.results) {
    const result = validateIndexerEvidenceAdapterResult(candidate);
    if (result.authorized_scope.source_ref !== input.source_ref) {
      throw new TypeError("Evidence Adapter Result belongs to another source identity");
    }
    for (const file of result.files) {
      if (file.module_ref !== input.module_ref || file.disposition !== "analyzed") continue;
      const contentDigest = input.file_content_digests[file.normalized_path];
      if (contentDigest === undefined) {
        throw new TypeError(
          `source identity inventory lacks content digest for ${file.normalized_path}`,
        );
      }
      const current = files.get(file.normalized_path) ?? {
        content_digest: indexerDigestSchema.parse(contentDigest),
        primary_owner_count: 0,
        facts: new Map<string, IndexerSourceIdentityFact>(),
      };
      if (current.content_digest !== contentDigest) {
        throw new TypeError("source identity inventory has conflicting file content digests");
      }
      if (file.role === "primary-owner") current.primary_owner_count += 1;
      for (const fact of file.facts) {
        const projected = sourceIdentityFact(fact);
        const previous = current.facts.get(projected.fact_ref);
        if (
          previous !== undefined &&
          canonicalIndexerJson(previous) !== canonicalIndexerJson(projected)
        ) {
          throw new TypeError("source identity inventory has conflicting fact locators");
        }
        current.facts.set(projected.fact_ref, projected);
      }
      files.set(file.normalized_path, current);
    }
  }
  if (files.size === 0) {
    throw new TypeError("source identity inventory requires analyzed source files");
  }
  for (const [path, file] of files) {
    if (file.primary_owner_count !== 1) {
      throw new TypeError(
        `source identity file ${path} requires exactly one primary owner`,
      );
    }
  }
  const knownPaths = [...files.keys()].sort(compareIndexerCanonicalText);
  const suppliedPaths = Object.keys(input.file_content_digests)
    .sort(compareIndexerCanonicalText);
  if (canonicalIndexerJson(knownPaths) !== canonicalIndexerJson(suppliedPaths)) {
    throw new TypeError(
      "source identity file content digest map must exactly match analyzed files",
    );
  }
  return buildIndexerSourceIdentityInventory({
    source_ref: input.source_ref,
    module_ref: input.module_ref,
    source_input_digest: input.source_input_digest,
    files: knownPaths.map((path) => {
      const file = files.get(path)!;
      return {
        normalized_path: path,
        content_digest: file.content_digest,
        facts: [...file.facts.values()],
      };
    }),
  });
}

const declarationTargetSchema = z.discriminatedUnion("target_type", [
  z.object({
    target_type: z.literal("directory"),
    normalized_path: portableIndexerPathSchema,
  }).strict(),
  z.object({
    target_type: z.literal("file"),
    normalized_path: portableIndexerPathSchema,
    content_digest: indexerDigestSchema,
  }).strict(),
  z.object({
    target_type: z.literal("item"),
    normalized_path: portableIndexerPathSchema,
    source_fact_ref: indexerCanonicalRefSchema,
    qualified_item_path: z.string().min(1).max(1024),
    signature_digest: indexerDigestSchema,
  }).strict(),
]);

const declarationPayloadSchema = z.object({
  carrier_kind: z.enum(INDEXER_STRUCTURED_DECLARATION_CARRIER_KINDS),
  carrier_ref: indexerCanonicalRefSchema,
  declaration_kind: z.enum(INDEXER_STRUCTURED_DECLARATION_KINDS),
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  target: declarationTargetSchema,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export const indexerStructuredDeclarationSchema = declarationPayloadSchema.extend({
  declaration_ref: indexerCanonicalRefSchema,
}).strict();

export const indexerStructuredDeclarationSetSchema = z.object({
  protocol: z.literal("context.indexer.structured-declaration-set/v1"),
  source_identity_inventory_digest: indexerDigestSchema,
  declarations: z.array(indexerStructuredDeclarationSchema).min(1),
  declaration_set_digest: indexerDigestSchema,
}).strict();

export type IndexerStructuredDeclarationPayload = z.infer<
  typeof declarationPayloadSchema
>;
export type IndexerStructuredDeclaration = z.infer<
  typeof indexerStructuredDeclarationSchema
>;
export type IndexerStructuredDeclarationSet = z.infer<
  typeof indexerStructuredDeclarationSetSchema
>;

function validateDeclarationTargetShape(
  declaration: IndexerStructuredDeclarationPayload,
): void {
  if (
    declaration.declaration_kind === "directory" &&
    declaration.target.target_type !== "directory"
  ) {
    throw new TypeError("directory declaration requires a directory target");
  }
  if (
    ["method", "handler", "store"].includes(declaration.declaration_kind) &&
    declaration.target.target_type !== "item"
  ) {
    throw new TypeError(
      `${declaration.declaration_kind} declaration requires an exact source item`,
    );
  }
  if (
    declaration.declaration_kind === "entry" &&
    declaration.target.target_type === "directory"
  ) {
    throw new TypeError("entry declaration requires a file or exact source item");
  }
  if (
    declaration.declaration_kind === "locator" &&
    declaration.target.target_type === "directory"
  ) {
    throw new TypeError("locator declaration requires a file or exact source item");
  }
}

export function indexerStructuredDeclarationRef(
  value: Omit<IndexerStructuredDeclarationPayload, "evidence_refs">,
): string {
  return `structured-declaration:${indexerProtocolDigest(value)}`;
}

function canonicalDeclaration(
  value: IndexerStructuredDeclarationPayload,
): IndexerStructuredDeclaration {
  const parsed = declarationPayloadSchema.parse({
    ...value,
    evidence_refs: canonicalUnique(value.evidence_refs, "declaration evidence_refs"),
  });
  validateDeclarationTargetShape(parsed);
  return indexerStructuredDeclarationSchema.parse({
    ...parsed,
    declaration_ref: indexerStructuredDeclarationRef({
      carrier_kind: parsed.carrier_kind,
      carrier_ref: parsed.carrier_ref,
      declaration_kind: parsed.declaration_kind,
      source_ref: parsed.source_ref,
      module_ref: parsed.module_ref,
      target: parsed.target,
    }),
  });
}

export function indexerStructuredDeclarationSetDigest(
  value: Omit<IndexerStructuredDeclarationSet, "declaration_set_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerStructuredDeclarationSet(input: {
  source_identity_inventory_digest: string;
  declarations: readonly IndexerStructuredDeclarationPayload[];
}): IndexerStructuredDeclarationSet {
  const declarations = input.declarations.map(canonicalDeclaration)
    .sort((left, right) =>
      compareIndexerCanonicalText(left.declaration_ref, right.declaration_ref)
    );
  canonicalUnique(
    declarations.map((declaration) => declaration.declaration_ref),
    "structured declarations",
  );
  const payload: Omit<IndexerStructuredDeclarationSet, "declaration_set_digest"> = {
    protocol: "context.indexer.structured-declaration-set/v1",
    source_identity_inventory_digest: indexerDigestSchema.parse(
      input.source_identity_inventory_digest,
    ),
    declarations,
  };
  return indexerStructuredDeclarationSetSchema.parse({
    ...payload,
    declaration_set_digest: indexerStructuredDeclarationSetDigest(payload),
  });
}

export type IndexerStructuredDeclarationCarrierAuthority = Record<
  typeof INDEXER_STRUCTURED_DECLARATION_CARRIER_KINDS[number],
  readonly string[]
>;

function validateTargetExists(input: {
  declaration: IndexerStructuredDeclaration;
  inventory: IndexerSourceIdentityInventory;
}): void {
  const target = input.declaration.target;
  if (target.target_type === "directory") {
    if (!input.inventory.files.some((file) =>
      file.normalized_path.startsWith(`${target.normalized_path}/`)
    )) {
      throw new TypeError(
        `structured declaration directory ${target.normalized_path} does not exist`,
      );
    }
    return;
  }
  const file = input.inventory.files.find((candidate) =>
    candidate.normalized_path === target.normalized_path
  );
  if (file === undefined) {
    throw new TypeError(
      `structured declaration file ${target.normalized_path} does not exist`,
    );
  }
  if (target.target_type === "file") {
    if (target.content_digest !== file.content_digest) {
      throw new TypeError("structured declaration file content identity is stale");
    }
    return;
  }
  const fact = file.facts.find((candidate) =>
    candidate.fact_ref === target.source_fact_ref
  );
  if (
    fact === undefined ||
    fact.qualified_item_path !== target.qualified_item_path ||
    fact.signature_digest !== target.signature_digest
  ) {
    throw new TypeError("structured declaration source item does not exist");
  }
}

export function validateIndexerStructuredDeclarationSet(input: {
  value: unknown;
  source_identity_inventory: unknown;
  expected_source_ref: string;
  expected_module_ref: string | null;
  carrier_authority: IndexerStructuredDeclarationCarrierAuthority;
  known_evidence_refs: readonly string[];
}): IndexerStructuredDeclarationSet {
  const value = indexerStructuredDeclarationSetSchema.parse(input.value);
  const rebuilt = buildIndexerStructuredDeclarationSet({
    source_identity_inventory_digest: value.source_identity_inventory_digest,
    declarations: value.declarations.map((declaration) => ({
      carrier_kind: declaration.carrier_kind,
      carrier_ref: declaration.carrier_ref,
      declaration_kind: declaration.declaration_kind,
      source_ref: declaration.source_ref,
      module_ref: declaration.module_ref,
      target: declaration.target,
      evidence_refs: declaration.evidence_refs,
    })),
  });
  if (canonicalIndexerJson(value) !== canonicalIndexerJson(rebuilt)) {
    throw new TypeError("structured declaration set is non-canonical or invalid");
  }
  const inventory = validateIndexerSourceIdentityInventory(
    input.source_identity_inventory,
  );
  if (
    value.source_identity_inventory_digest !== inventory.inventory_digest ||
    inventory.source_ref !== input.expected_source_ref ||
    inventory.module_ref !== input.expected_module_ref
  ) {
    throw new TypeError("structured declarations do not match current source identity");
  }
  const evidence = new Set(canonicalUnique(
    input.known_evidence_refs,
    "known declaration evidence",
  ));
  const carriers: Record<
    typeof INDEXER_STRUCTURED_DECLARATION_CARRIER_KINDS[number],
    ReadonlySet<string>
  > = {
    "indexer-result": new Set(canonicalUnique(
      input.carrier_authority["indexer-result"],
      "indexer-result carriers",
    )),
    catalog: new Set(canonicalUnique(
      input.carrier_authority.catalog,
      "catalog carriers",
    )),
    manifest: new Set(canonicalUnique(
      input.carrier_authority.manifest,
      "manifest carriers",
    )),
    "section-evidence": new Set(canonicalUnique(
      input.carrier_authority["section-evidence"],
      "section-evidence carriers",
    )),
  };
  for (const declaration of value.declarations) {
    if (
      declaration.source_ref !== inventory.source_ref ||
      declaration.module_ref !== inventory.module_ref
    ) {
      throw new TypeError("structured declaration escapes current source/module");
    }
    if (!carriers[declaration.carrier_kind].has(declaration.carrier_ref)) {
      throw new TypeError("structured declaration references an unauthorized carrier");
    }
    if (declaration.evidence_refs.some((ref) => !evidence.has(ref))) {
      throw new TypeError("structured declaration references unknown evidence");
    }
    validateDeclarationTargetShape(declaration);
    validateTargetExists({ declaration, inventory });
  }
  return value;
}

export function indexerSectionEvidenceCarrierRef(input: {
  logical_unit_ref: string;
  artifact_id: string;
  section_key: string;
}): string {
  return `section-evidence:${indexerProtocolDigest(input)}`;
}
