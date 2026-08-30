import {
  buildIndexerEvidenceAdapterResult,
  createIndexerEvidenceAdapterFact,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterProtocolDigest,
  type IndexerEvidenceAdapterFact,
  type IndexerEvidenceAdapterResult,
} from "@c4a/core";
import { parseProtoSources, type ProtoDocument, type ProtoLocator } from "./protoParser.js";

export * from "./protoLexer.js";
export * from "./protoParser.js";

export const PROTO_EVIDENCE_ADAPTER_EXPORT = "protoSourcesToEvidenceAdapterResult";

export interface ProtoEvidenceAdapterInvocation {
  adapter: IndexerEvidenceAdapterResult["adapter"];
  authorized_scope: IndexerEvidenceAdapterResult["authorized_scope"];
  input_digest: string;
  precedence: number;
  import_roots?: readonly string[];
  module_refs?: Readonly<Record<string, string | null>>;
  role?: "primary-owner" | "enricher";
}

function assertModuleAuthorized(moduleRef: string | null, invocation: ProtoEvidenceAdapterInvocation): void {
  if (moduleRef !== null && !invocation.authorized_scope.module_refs.includes(moduleRef)) {
    throw new TypeError(`Proto module ${moduleRef} escapes authorized scope`);
  }
}

function fact(input: {
  invocation: ProtoEvidenceAdapterInvocation;
  document: ProtoDocument;
  moduleRef: string | null;
  locator: ProtoLocator;
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

function analyzedFacts(document: ProtoDocument, invocation: ProtoEvidenceAdapterInvocation, moduleRef: string | null, ownsDenominators: boolean): IndexerEvidenceAdapterFact[] {
  const facts: IndexerEvidenceAdapterFact[] = [];
  const add = (input: Omit<Parameters<typeof fact>[0], "invocation" | "document" | "moduleRef">): void => {
    facts.push(fact({ ...input, invocation, document, moduleRef }));
  };
  const denominator = ownsDenominators ? "protocol-item" as const : "none" as const;
  const rootLocator = { path: document.path, line: 1, column: 1 };
  add({ locator: rootLocator, qualifiedItemPath: "file", kind: "source-file", signature: { catalog: "proto" }, payload: { path: document.path }, denominator: ownsDenominators ? "eligible-file" : "none" });
  add({ locator: rootLocator, qualifiedItemPath: "generated-boundary", kind: "generated-source-boundary", signature: { sourceKind: "protobuf-idl" }, payload: { authority: "contract-source", generated_outputs: "derived" }, denominator: "none" });
  if (document.package !== null) add({ locator: rootLocator, qualifiedItemPath: `package:${document.package}`, kind: "proto-package", signature: { package: document.package, syntax: document.syntax }, payload: { package: document.package, syntax: document.syntax }, denominator: "none" });
  for (const item of document.imports) {
    const path = `import:${item.path}`;
    add({ locator: item.locator, qualifiedItemPath: path, kind: "protocol-import", signature: { path: item.path, modifier: item.modifier, resolved: item.resolved_path }, payload: item, denominator });
    add({ locator: item.locator, qualifiedItemPath: `${path}:disposition`, kind: "protocol-disposition", signature: { item: path }, payload: { disposition: "analyzed", item_kind: "import" }, denominator: "none" });
  }
  for (const item of document.options) add({ locator: item.locator, qualifiedItemPath: `option:${item.owner}:${item.name}`, kind: "proto-option", signature: { owner: item.owner, name: item.name }, payload: item, denominator: "none" });
  for (const item of document.types) {
    const path = `type:${item.qualified_name}`;
    add({ locator: item.locator, qualifiedItemPath: path, kind: "protocol-type", signature: { kind: item.kind, name: item.qualified_name }, payload: item, denominator });
    add({ locator: item.locator, qualifiedItemPath: `${path}:disposition`, kind: "protocol-disposition", signature: { item: path }, payload: { disposition: "analyzed", item_kind: "type" }, denominator: "none" });
  }
  for (const service of document.services) {
    const servicePath = `service:${service.name}`;
    add({ locator: service.locator, qualifiedItemPath: servicePath, kind: "protocol-service", signature: { name: service.name }, payload: service, denominator });
    add({ locator: service.locator, qualifiedItemPath: `${servicePath}:disposition`, kind: "protocol-disposition", signature: { item: servicePath }, payload: { disposition: "analyzed", item_kind: "service" }, denominator: "none" });
    for (const method of service.methods) {
      const methodPath = `${servicePath}:method:${method.name}`;
      add({ locator: method.locator, qualifiedItemPath: methodPath, kind: "protocol-method", signature: { service: service.name, ...method }, payload: method, denominator });
      add({ locator: method.locator, qualifiedItemPath: `${methodPath}:disposition`, kind: "protocol-disposition", signature: { item: methodPath }, payload: { disposition: "analyzed", item_kind: "method" }, denominator: "none" });
    }
  }
  return facts;
}

/** Parses only the caller-provided source map and converts it to the common Evidence ABI. */
export function protoSourcesToEvidenceAdapterResult(files: Readonly<Record<string, string>>, invocation: ProtoEvidenceAdapterInvocation): IndexerEvidenceAdapterResult {
  const role = invocation.role ?? "primary-owner";
  const documents = invocation.import_roots === undefined
    ? parseProtoSources(files)
    : parseProtoSources(files, { import_roots: invocation.import_roots });
  const diagnostics: IndexerEvidenceAdapterResult["diagnostics"] = [];
  const evidenceFiles = documents.map((document) => {
    const moduleRef = invocation.module_refs?.[document.path] ?? null;
    assertModuleAuthorized(moduleRef, invocation);
    const fileRef = indexerEvidenceAdapterFileRef({ source_ref: invocation.authorized_scope.source_ref, module_ref: moduleRef, normalized_path: document.path });
    if (document.diagnostic !== null) diagnostics.push({ code: "proto-source-unsupported", severity: "error", fact_ref: fileRef, detail_digest: indexerEvidenceAdapterProtocolDigest({ path: document.path, diagnostic: document.diagnostic }) });
    return {
      file_ref: fileRef,
      source_ref: invocation.authorized_scope.source_ref,
      module_ref: moduleRef,
      normalized_path: document.path,
      role,
      coverage_tier: "ast-catalog" as const,
      disposition: document.disposition,
      facts: document.disposition === "analyzed" ? analyzedFacts(document, invocation, moduleRef, role === "primary-owner") : [],
    };
  });
  const parserOutputDigest = indexerEvidenceAdapterProtocolDigest(documents);
  return buildIndexerEvidenceAdapterResult({
    protocol: "context.indexer.evidence-adapter-result/v1",
    adapter: invocation.adapter,
    authorized_scope: invocation.authorized_scope,
    input_digest: invocation.input_digest,
    precedence: invocation.precedence,
    files: evidenceFiles,
    diagnostics,
    toolchain: [{
      step: "parse-protobuf-idl",
      package: invocation.adapter.package,
      export: invocation.adapter.export,
      version: invocation.adapter.version,
      digest: invocation.adapter.digest,
      capabilities: ["parser.proto", "protocol-generated-boundary", "protocol-imports", "protocol-methods", "protocol-options", "protocol-services", "protocol-types"],
      input_digest: invocation.input_digest,
      output_digest: parserOutputDigest,
    }],
  });
}
