import {
  buildIndexerEvidenceAdapterResult,
  createIndexerEvidenceAdapterFact,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterProtocolDigest,
  type IndexerEvidenceAdapterFact,
  type IndexerEvidenceAdapterResult,
} from "@c4a/core";
import { parseContractSources } from "./contractParser.js";
import type { ContractDocumentCatalog, ContractLocator } from "./contractTypes.js";

export interface ContractEvidenceAdapterInvocation {
  adapter: IndexerEvidenceAdapterResult["adapter"];
  authorized_scope: IndexerEvidenceAdapterResult["authorized_scope"];
  input_digest: string;
  precedence: number;
  module_refs?: Readonly<Record<string, string | null>>;
  role?: "primary-owner" | "enricher";
}

function assertModuleAuthorized(moduleRef: string | null, invocation: ContractEvidenceAdapterInvocation): void {
  if (moduleRef !== null && !invocation.authorized_scope.module_refs.includes(moduleRef)) {
    throw new TypeError(`contract module ${moduleRef} escapes authorized scope`);
  }
}

function createFact(input: {
  invocation: ContractEvidenceAdapterInvocation;
  document: ContractDocumentCatalog;
  moduleRef: string | null;
  locator: ContractLocator;
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
    signature: { path: input.locator.path, line: input.locator.line, column: input.locator.column, value: input.signature },
    payload: input.payload,
    denominator: input.denominator,
  });
}

function analyzedFacts(
  document: ContractDocumentCatalog,
  invocation: ContractEvidenceAdapterInvocation,
  moduleRef: string | null,
  ownsDenominators: boolean,
): IndexerEvidenceAdapterFact[] {
  const facts: IndexerEvidenceAdapterFact[] = [];
  const add = (input: Omit<Parameters<typeof createFact>[0], "invocation" | "document" | "moduleRef">): void => {
    facts.push(createFact({ ...input, invocation, document, moduleRef }));
  };
  const protocolDenominator = ownsDenominators ? "protocol-item" as const : "none" as const;
  const root: ContractLocator = { path: document.path, line: 1, column: 1, qualified_item_path: "file" };
  add({ locator: root, qualifiedItemPath: "file", kind: "source-file", signature: { catalog: document.format, version: document.version }, payload: { path: document.path, format: document.format }, denominator: ownsDenominators ? "eligible-file" : "none" });
  add({ locator: root, qualifiedItemPath: "generated-boundary", kind: "generated-source-boundary", signature: { sourceKind: document.format }, payload: { authority: "contract-source", generated_outputs: "derived" }, denominator: "none" });

  for (const endpoint of document.endpoints) {
    add({ locator: endpoint.locator, qualifiedItemPath: endpoint.locator.qualified_item_path, kind: "contract-endpoint", signature: { protocol: endpoint.protocol, endpoint_ref: endpoint.endpoint_ref, path_or_type: endpoint.path_or_type }, payload: endpoint, denominator: protocolDenominator });
    add({ locator: endpoint.locator, qualifiedItemPath: `${endpoint.locator.qualified_item_path}:disposition`, kind: "protocol-disposition", signature: { item: endpoint.endpoint_ref }, payload: { disposition: "analyzed", item_kind: "endpoint" }, denominator: "none" });
  }
  for (const operation of document.operations) {
    add({ locator: operation.locator, qualifiedItemPath: operation.locator.qualified_item_path, kind: "contract-operation", signature: { protocol: operation.protocol, operation_ref: operation.operation_ref, operation_kind: operation.operation_kind, name: operation.name, parent: operation.parent }, payload: operation, denominator: protocolDenominator });
    add({ locator: operation.locator, qualifiedItemPath: `${operation.locator.qualified_item_path}:disposition`, kind: "protocol-disposition", signature: { item: operation.operation_ref }, payload: { disposition: "analyzed", item_kind: "operation" }, denominator: "none" });
  }
  for (const type of document.types) {
    add({ locator: type.locator, qualifiedItemPath: type.locator.qualified_item_path, kind: "contract-type", signature: { protocol: type.protocol, type_ref: type.type_ref, kind: type.kind, name: type.name, extension: type.extension }, payload: type, denominator: protocolDenominator });
    add({ locator: type.locator, qualifiedItemPath: `${type.locator.qualified_item_path}:disposition`, kind: "protocol-disposition", signature: { item: type.type_ref }, payload: { disposition: "analyzed", item_kind: "type" }, denominator: "none" });
  }
  for (const reference of document.references) {
    add({ locator: reference.locator, qualifiedItemPath: reference.locator.qualified_item_path, kind: "contract-reference", signature: { protocol: reference.protocol, reference_ref: reference.reference_ref, target_path: reference.target_path, target_item_path: reference.target_item_path }, payload: reference, denominator: protocolDenominator });
    add({ locator: reference.locator, qualifiedItemPath: `${reference.locator.qualified_item_path}:disposition`, kind: "protocol-disposition", signature: { item: reference.reference_ref }, payload: { disposition: "analyzed", item_kind: "reference" }, denominator: "none" });
  }
  return facts;
}

/** Parses caller-registered contract text and emits only the common Evidence ABI. */
export function contractSourcesToEvidenceAdapterResult(
  files: Readonly<Record<string, string>>,
  invocation: ContractEvidenceAdapterInvocation,
): IndexerEvidenceAdapterResult {
  const role = invocation.role ?? "primary-owner";
  const documents = parseContractSources(files);
  const diagnostics: IndexerEvidenceAdapterResult["diagnostics"] = [];
  const evidenceFiles = documents.map((document) => {
    const moduleRef = invocation.module_refs?.[document.path] ?? null;
    assertModuleAuthorized(moduleRef, invocation);
    const fileRef = indexerEvidenceAdapterFileRef({
      source_ref: invocation.authorized_scope.source_ref,
      module_ref: moduleRef,
      normalized_path: document.path,
    });
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
        ? analyzedFacts(document, invocation, moduleRef, role === "primary-owner")
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
      step: "parse-contract-catalog",
      package: invocation.adapter.package,
      export: invocation.adapter.export,
      version: invocation.adapter.version,
      digest: invocation.adapter.digest,
      capabilities: ["contract-external-references", "contract-operations", "contract-types", "parser.graphql", "parser.openapi", "protocol-generated-boundary"],
      input_digest: invocation.input_digest,
      output_digest: indexerEvidenceAdapterProtocolDigest(documents),
    }],
  });
}
