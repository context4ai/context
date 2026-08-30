import {
  buildIndexerEvidenceAdapterResult,
  createIndexerEvidenceAdapterFact,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterProtocolDigest,
  type IndexerEvidenceAdapterFact,
  type IndexerEvidenceAdapterResult,
} from "@c4a/core";
import { parseMdxSources } from "./mdxParser.js";
import type { MdxDocumentCatalog, MdxLocator, MdxPublicTarget } from "./mdxTypes.js";

export interface MdxEvidenceAdapterInvocation {
  adapter: IndexerEvidenceAdapterResult["adapter"];
  authorized_scope: IndexerEvidenceAdapterResult["authorized_scope"];
  input_digest: string;
  precedence: number;
  public_targets?: readonly MdxPublicTarget[];
  module_refs?: Readonly<Record<string, string | null>>;
  role?: "primary-owner" | "enricher";
}

function assertModuleAuthorized(moduleRef: string | null, invocation: MdxEvidenceAdapterInvocation): void {
  if (moduleRef !== null && !invocation.authorized_scope.module_refs.includes(moduleRef)) {
    throw new TypeError(`MDX module ${moduleRef} escapes authorized scope`);
  }
}

function createFact(input: {
  invocation: MdxEvidenceAdapterInvocation;
  document: MdxDocumentCatalog;
  moduleRef: string | null;
  locator: MdxLocator;
  qualifiedItemPath: string;
  kind: string;
  signature: unknown;
  payload: unknown;
  denominator: IndexerEvidenceAdapterFact["denominator"];
}): IndexerEvidenceAdapterFact {
  return createIndexerEvidenceAdapterFact({
    source_ref: input.invocation.authorized_scope.source_ref,
    module_ref: input.moduleRef,
    normalized_path: input.document.path,
    qualified_item_path: input.qualifiedItemPath,
    kind: input.kind,
    signature: { ...input.locator, value: input.signature },
    payload: input.payload,
    denominator: input.denominator,
  });
}

function documentFacts(document: MdxDocumentCatalog, invocation: MdxEvidenceAdapterInvocation, moduleRef: string | null, ownsDenominators: boolean): IndexerEvidenceAdapterFact[] {
  const facts: IndexerEvidenceAdapterFact[] = [];
  const add = (input: Omit<Parameters<typeof createFact>[0], "invocation" | "document" | "moduleRef">): void => {
    facts.push(createFact({ ...input, invocation, document, moduleRef }));
  };
  const root = { path: document.path, line: 1, column: 1 };
  add({ locator: root, qualifiedItemPath: "file", kind: "source-file", signature: { catalog: "mdx" }, payload: { path: document.path }, denominator: ownsDenominators ? "eligible-file" : "none" });
  document.imports.forEach((item, index) => add({ locator: item.locator, qualifiedItemPath: `esm-import:${index + 1}:${item.local_name}`, kind: "mdx-esm-import", signature: item, payload: item, denominator: "none" }));
  document.exports.forEach((item, index) => add({ locator: item.locator, qualifiedItemPath: `esm-export:${index + 1}:${item.exported_name}`, kind: "mdx-esm-export", signature: item, payload: item, denominator: ownsDenominators ? "symbol" : "none" }));
  document.components.forEach((item, index) => add({ locator: item.locator, qualifiedItemPath: `component:${index + 1}:${item.component_name}`, kind: "mdx-component-reference", signature: { component_name: item.component_name, source_module: item.source_module, imported_name: item.imported_name, target_ref: item.target_ref }, payload: item, denominator: ownsDenominators ? "protocol-item" : "none" }));
  document.examples.forEach((item, index) => {
    add({ locator: item.locator, qualifiedItemPath: `example:${index + 1}:${item.kind}`, kind: "mdx-example", signature: { example_ref: item.example_ref, kind: item.kind, language: item.language, content_digest: item.content_digest }, payload: item, denominator: ownsDenominators ? "protocol-item" : "none" });
    item.target_refs.forEach((targetRef, targetIndex) => add({ locator: item.locator, qualifiedItemPath: `example:${index + 1}:target:${targetIndex + 1}`, kind: "mdx-public-target-link", signature: { example_ref: item.example_ref, target_ref: targetRef }, payload: { example_ref: item.example_ref, target_ref: targetRef }, denominator: "none" }));
  });
  return facts;
}

export function mdxSourcesToEvidenceAdapterResult(files: Readonly<Record<string, string>>, invocation: MdxEvidenceAdapterInvocation): IndexerEvidenceAdapterResult {
  const role = invocation.role ?? "primary-owner";
  const documents = invocation.public_targets === undefined
    ? parseMdxSources(files)
    : parseMdxSources(files, { public_targets: invocation.public_targets });
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
      coverage_tier: "ast-catalog" as const,
      disposition: document.disposition,
      facts: document.disposition === "analyzed"
        ? documentFacts(document, invocation, moduleRef, role === "primary-owner")
        : [],
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
      step: "parse-mdx-catalog",
      package: invocation.adapter.package,
      export: invocation.adapter.export,
      version: invocation.adapter.version,
      digest: invocation.adapter.digest,
      capabilities: ["parser.mdx", "mdx-components", "mdx-esm", "mdx-examples", "mdx-public-target-linkage"],
      input_digest: invocation.input_digest,
      output_digest: indexerEvidenceAdapterProtocolDigest(documents),
    }],
  });
}
