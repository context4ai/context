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
import { parseConfigSources } from "./configEvidenceParser.js";
import type {
  ConfigDocumentCatalog,
  ConfigEvidenceAdapterInvocation,
  ConfigParseOptions,
  ConfigValueFact,
} from "./configEvidenceTypes.js";

function assertModuleAuthorized(moduleRef: string | null, invocation: ConfigEvidenceAdapterInvocation): void {
  if (moduleRef !== null && !invocation.authorized_scope.module_refs.includes(moduleRef)) {
    throw new TypeError(`config module ${moduleRef} escapes authorized scope`);
  }
}

function fact(
  document: ConfigDocumentCatalog,
  value: ConfigValueFact,
  invocation: ConfigEvidenceAdapterInvocation,
  moduleRef: string | null,
): IndexerEvidenceAdapterFact {
  const semantic = {
    config_ref: value.config_ref,
    key_path: value.key_path,
    value_type: value.value_type,
    classification: value.classification,
    boundary_candidate: value.boundary_candidate,
    value_digest: value.value_digest,
    ...(value.normalized_value !== undefined ? { normalized_value: value.normalized_value } : {}),
    locator: value.locator,
  };
  return createIndexerEvidenceAdapterFact({
    source_ref: invocation.authorized_scope.source_ref,
    module_ref: moduleRef,
    normalized_path: document.path,
    qualified_item_path: value.locator.qualified_item_path,
    kind: "config-value",
    signature: semantic,
    payload: semantic,
    denominator: "none",
  });
}

export function configSourcesToEvidenceAdapterResult(
  files: Readonly<Record<string, string>>,
  invocation: ConfigEvidenceAdapterInvocation,
  options: ConfigParseOptions = {},
): IndexerEvidenceAdapterResult {
  const role = invocation.role ?? "primary-owner";
  const documents = parseConfigSources(files, options);
  const diagnostics: IndexerEvidenceAdapterResult["diagnostics"] = [];
  const evidenceFiles = documents.map((document) => {
    const moduleRef = invocation.module_refs?.[document.path] ?? null;
    assertModuleAuthorized(moduleRef, invocation);
    const fileRef = indexerEvidenceAdapterFileRef({
      source_ref: invocation.authorized_scope.source_ref,
      module_ref: moduleRef,
      normalized_path: document.path,
    });
    for (const diagnostic of document.diagnostics) {
      diagnostics.push({
        code: diagnostic.code,
        severity: diagnostic.severity,
        fact_ref: fileRef,
        detail_digest: indexerEvidenceAdapterProtocolDigest({
          locator: diagnostic.locator,
          detail: diagnostic.detail,
        }),
      });
    }
    const sourceFact = document.disposition === "analyzed"
      ? createIndexerEvidenceAdapterFact({
        source_ref: invocation.authorized_scope.source_ref,
        module_ref: moduleRef,
        normalized_path: document.path,
        qualified_item_path: "file",
        kind: "source-file",
        signature: { catalog: "config", format: document.format, tier: "lightweight-evidence" },
        payload: { path: document.path, format: document.format },
        denominator: "none",
      })
      : null;
    return {
      file_ref: fileRef,
      source_ref: invocation.authorized_scope.source_ref,
      module_ref: moduleRef,
      normalized_path: document.path,
      role,
      coverage_tier: "lightweight-evidence" as const,
      disposition: document.disposition,
      facts: sourceFact === null
        ? []
        : [sourceFact, ...document.values.map((value) => fact(document, value, invocation, moduleRef))],
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
      step: "parse-config-evidence",
      package: invocation.adapter.package,
      export: invocation.adapter.export,
      version: invocation.adapter.version,
      digest: invocation.adapter.digest,
      capabilities: ["config-boundary-candidates", "config-schema-neutral", "parser.json", "parser.toml", "parser.yaml"],
      input_digest: invocation.input_digest,
      output_digest: indexerEvidenceAdapterProtocolDigest(documents),
    }],
  });
}

/** Builds the wire result and its process-local structured fact payload sidecar. */
export function configSourcesToEvidenceAdapterMaterialization(
  files: Readonly<Record<string, string>>,
  invocation: ConfigEvidenceAdapterInvocation,
  options: ConfigParseOptions = {},
): IndexerEvidenceAdapterMaterialization {
  return materializeIndexerEvidenceAdapterResult(
    configSourcesToEvidenceAdapterResult(files, invocation, options),
  );
}
