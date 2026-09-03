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
import { parseSqlSources } from "./sqlParser.js";
import type { SqlDocumentCatalog, SqlLocator, SqlParseOptions } from "./sqlTypes.js";

export interface SqlEvidenceAdapterInvocation extends SqlParseOptions {
  adapter: IndexerEvidenceAdapterResult["adapter"];
  authorized_scope: IndexerEvidenceAdapterResult["authorized_scope"];
  input_digest: string;
  precedence: number;
  module_refs?: Readonly<Record<string, string | null>>;
  role?: "primary-owner" | "enricher";
}

function assertModuleAuthorized(moduleRef: string | null, invocation: SqlEvidenceAdapterInvocation): void {
  if (moduleRef !== null && !invocation.authorized_scope.module_refs.includes(moduleRef)) {
    throw new TypeError(`SQL module ${moduleRef} escapes authorized scope`);
  }
}

function fact(input: {
  invocation: SqlEvidenceAdapterInvocation;
  document: SqlDocumentCatalog;
  moduleRef: string | null;
  locator: SqlLocator;
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

function analyzedFacts(document: SqlDocumentCatalog, invocation: SqlEvidenceAdapterInvocation, moduleRef: string | null): IndexerEvidenceAdapterFact[] {
  const facts: IndexerEvidenceAdapterFact[] = [];
  const add = (locator: SqlLocator, kind: string, signature: unknown, payload: unknown): void => {
    facts.push(fact({ invocation, document, moduleRef, locator, kind, signature, payload }));
  };
  const root: SqlLocator = { path: document.path, line: 1, column: 1, qualified_item_path: "file" };
  add(root, "source-file", { catalog: "sql", tier: "lightweight-evidence", dialect: document.dialect }, { path: document.path, dialect: document.dialect });
  for (const item of document.statements) add(item.locator, "sql-statement", { statement_ref: item.statement_ref, dialect: item.dialect, statement_type: item.statement_type, category: item.category, statement_digest: item.statement_digest }, item);
  for (const item of document.objects) add(item.locator, "sql-object", { object_ref: item.object_ref, object_kind: item.object_kind, name: item.name, operation: item.operation, ddl_action: item.ddl_action, statement_ref: item.statement_ref }, item);
  for (const item of document.migrations) add(item.locator, "sql-migration-candidate", { migration_ref: item.migration_ref, direction: item.direction, sequence: item.sequence, basis: item.basis }, item);
  return facts;
}

export function sqlSourcesToEvidenceAdapterResult(
  files: Readonly<Record<string, string>>,
  invocation: SqlEvidenceAdapterInvocation,
): IndexerEvidenceAdapterResult {
  const role = invocation.role ?? "primary-owner";
  const documents = parseSqlSources(files, { dialects: invocation.dialects });
  const diagnostics: IndexerEvidenceAdapterResult["diagnostics"] = [];
  const evidenceFiles = documents.map((document) => {
    const moduleRef = invocation.module_refs?.[document.path] ?? null;
    assertModuleAuthorized(moduleRef, invocation);
    const fileRef = indexerEvidenceAdapterFileRef({ source_ref: invocation.authorized_scope.source_ref, module_ref: moduleRef, normalized_path: document.path });
    for (const diagnostic of document.diagnostics) diagnostics.push({ code: diagnostic.code, severity: diagnostic.severity, fact_ref: fileRef, detail_digest: indexerEvidenceAdapterProtocolDigest({ locator: diagnostic.locator, detail: diagnostic.detail }) });
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
      step: "parse-sql-evidence",
      package: invocation.adapter.package,
      export: invocation.adapter.export,
      version: invocation.adapter.version,
      digest: invocation.adapter.digest,
      capabilities: ["parser.sql", "sql-ddl", "sql-migrations", "sql-read-write", "sql-statement-locators"],
      input_digest: invocation.input_digest,
      output_digest: indexerEvidenceAdapterProtocolDigest(documents),
    }],
  });
}

export function sqlSourcesToEvidenceAdapterMaterialization(
  files: Readonly<Record<string, string>>,
  invocation: SqlEvidenceAdapterInvocation,
): IndexerEvidenceAdapterMaterialization {
  return materializeIndexerEvidenceAdapterResult(
    sqlSourcesToEvidenceAdapterResult(files, invocation),
  );
}
