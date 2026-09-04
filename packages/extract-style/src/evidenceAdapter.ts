import {
  buildIndexerEvidenceAdapterResult,
  createIndexerEvidenceAdapterFact,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterProtocolDigest,
  materializeIndexerEvidenceAdapterResult,
  type IndexerEvidenceAdapterFact,
  type IndexerEvidenceAdapterMaterialization,
  type IndexerEvidenceAdapterResult,
} from "@c4a/core";
import { parseStyleSources } from "./styleParser.js";
import type { StyleDocumentCatalog, StyleLocator } from "./styleTypes.js";

export interface StyleEvidenceAdapterInvocation {
  adapter: IndexerEvidenceAdapterResult["adapter"];
  authorized_scope: IndexerEvidenceAdapterResult["authorized_scope"];
  input_digest: string;
  precedence: number;
  module_refs?: Readonly<Record<string, string | null>>;
  role?: "primary-owner" | "enricher";
}

function assertModuleAuthorized(moduleRef: string | null, invocation: StyleEvidenceAdapterInvocation): void {
  if (moduleRef !== null && !invocation.authorized_scope.module_refs.includes(moduleRef)) {
    throw new TypeError(`style module ${moduleRef} escapes authorized scope`);
  }
}

function fact(input: {
  invocation: StyleEvidenceAdapterInvocation;
  document: StyleDocumentCatalog;
  moduleRef: string | null;
  locator: StyleLocator;
  kind: string;
  signature: unknown;
  payload: unknown;
}): IndexerEvidenceAdapterFact {
  return createIndexerEvidenceAdapterFact({
    source_ref: input.invocation.authorized_scope.source_ref,
    module_ref: input.moduleRef,
    normalized_path: input.document.path,
    qualified_item_path: input.locator.qualified_item_path,
    kind: input.kind,
    signature: { path: input.locator.path, line: input.locator.line, column: input.locator.column, value: input.signature },
    payload: input.payload,
    denominator: "none",
  });
}

function analyzedFacts(document: StyleDocumentCatalog, invocation: StyleEvidenceAdapterInvocation, moduleRef: string | null): IndexerEvidenceAdapterFact[] {
  const facts: IndexerEvidenceAdapterFact[] = [];
  const add = (locator: StyleLocator, kind: string, signature: unknown, payload: unknown): void => {
    facts.push(fact({ invocation, document, moduleRef, locator, kind, signature, payload }));
  };
  const root: StyleLocator = { path: document.path, line: 1, column: 1, qualified_item_path: "file" };
  add(root, "source-file", { catalog: document.syntax, tier: "lightweight-evidence" }, { path: document.path, syntax: document.syntax });
  for (const item of document.imports) add(item.locator, "style-import", { import_ref: item.import_ref, kind: item.kind, specifier_digest: item.specifier_digest, resolution: item.resolution, resolved_path: item.resolved_path }, item);
  for (const item of document.tokens) add(item.locator, "style-token", { token_ref: item.token_ref, name: item.name, syntax: item.syntax, configurable: item.configurable, value_digest: item.value_digest }, item);
  for (const item of document.token_references) add(item.locator, "style-token-reference", { reference_ref: item.reference_ref, name: item.name, owner: item.owner_qualified_item_path }, item);
  for (const item of document.selectors) add(item.locator, "style-selector", { selector_ref: item.selector_ref, selector_digest: item.selector_digest, class_names: item.class_names, id_names: item.id_names, type_names: item.type_names, pseudo_classes: item.pseudo_classes, attribute_names: item.attribute_names }, item);
  for (const item of document.variants_and_states) add({ ...item.locator, qualified_item_path: `${item.locator.qualified_item_path}:variant:${item.evidence_kind}:${item.name}` }, "style-variant-state", { selector_ref: item.selector_ref, evidence_kind: item.evidence_kind, name: item.name }, item);
  for (const item of document.component_candidates) add(item.locator, "style-component-candidate", { candidate_ref: item.candidate_ref, name: item.name, basis: item.basis, selector_ref: item.selector_ref }, item);
  return facts;
}

export function styleSourcesToEvidenceAdapterResult(
  files: Readonly<Record<string, string>>,
  invocation: StyleEvidenceAdapterInvocation,
): IndexerEvidenceAdapterResult {
  const role = invocation.role ?? "primary-owner";
  const documents = parseStyleSources(files);
  const diagnostics: IndexerEvidenceAdapterResult["diagnostics"] = [];
  const evidenceFiles = documents.map((document) => {
    const moduleRef = invocation.module_refs?.[document.path] ?? null;
    assertModuleAuthorized(moduleRef, invocation);
    const fileRef = indexerEvidenceAdapterFileRef({ source_ref: invocation.authorized_scope.source_ref, module_ref: moduleRef, normalized_path: document.path });
    for (const diagnostic of document.diagnostics) diagnostics.push({
      code: diagnostic.code,
      severity: diagnostic.severity,
      fact_ref: fileRef,
      detail_digest: indexerEvidenceAdapterProtocolDigest({ locator: diagnostic.locator, detail: diagnostic.detail }),
    });
    return {
      file_ref: fileRef,
      source_ref: invocation.authorized_scope.source_ref,
      module_ref: moduleRef,
      normalized_path: document.path,
      role,
      coverage_tier: "lightweight-evidence" as const,
      disposition: document.disposition,
      facts: document.disposition === "analyzed" ? analyzedFacts(document, invocation, moduleRef) : [],
    };
  });
  return buildIndexerEvidenceAdapterResult({
    protocol: "context.indexer.evidence-adapter-result/v1",
    adapter: invocation.adapter,
    authorized_scope: invocation.authorized_scope,
    input_digest: invocation.input_digest,
    precedence: invocation.precedence,
    files: evidenceFiles,
    diagnostics,
    toolchain: [{
      step: "parse-style-evidence",
      package: invocation.adapter.package,
      export: invocation.adapter.export,
      version: invocation.adapter.version,
      digest: invocation.adapter.digest,
      capabilities: ["parser.css", "parser.scss", "style-component-candidates", "style-imports", "style-selectors", "style-tokens", "style-variant-states"],
      input_digest: invocation.input_digest,
      output_digest: indexerEvidenceAdapterProtocolDigest(documents),
    }],
  });
}

export function styleSourcesToEvidenceAdapterMaterialization(
  files: Readonly<Record<string, string>>,
  invocation: StyleEvidenceAdapterInvocation,
): IndexerEvidenceAdapterMaterialization {
  return materializeIndexerEvidenceAdapterResult(
    styleSourcesToEvidenceAdapterResult(files, invocation),
  );
}
