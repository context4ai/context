import {
  buildIndexerEvidenceAdapterResult,
  createIndexerEvidenceAdapterFact,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterProtocolDigest,
  materializeIndexerEvidenceAdapterResult,
  redactIndexerOutput,
  type IndexerEvidenceAdapterFact,
  type IndexerEvidenceAdapterMaterialization,
  type IndexerEvidenceAdapterResult,
} from "@c4a/core";
import type { ExtractionDiagnostic, ExtractionResult, RelationInfo, SymbolInfo } from "./types.js";

export interface ExtractionEvidenceAdapterInvocation {
  adapter: IndexerEvidenceAdapterResult["adapter"];
  authorized_scope: IndexerEvidenceAdapterResult["authorized_scope"];
  module_ref: string | null;
  input_digest: string;
  precedence: number;
  role?: "primary-owner" | "enricher";
}

function fact(input: {
  sourceRef: string;
  moduleRef: string | null;
  normalizedPath: string;
  qualifiedItemPath: string;
  kind: string;
  signature: unknown;
  payload: unknown;
  denominator: IndexerEvidenceAdapterFact["denominator"];
}): IndexerEvidenceAdapterFact {
  const payload = redactIndexerOutput({
    channel: "success-payload",
    value: input.payload,
  }).value;
  return createIndexerEvidenceAdapterFact({
    source_ref: input.sourceRef,
    module_ref: input.moduleRef,
    normalized_path: input.normalizedPath,
    qualified_item_path: input.qualifiedItemPath,
    kind: input.kind,
    signature: input.signature,
    payload,
    denominator: input.denominator,
  });
}

function uniqueFacts(facts: readonly IndexerEvidenceAdapterFact[]): IndexerEvidenceAdapterFact[] {
  const byRef = new Map<string, IndexerEvidenceAdapterFact>();
  for (const value of facts) {
    const previous = byRef.get(value.fact_ref);
    if (
      previous !== undefined &&
      indexerEvidenceAdapterProtocolDigest(previous) !==
        indexerEvidenceAdapterProtocolDigest(value)
    ) {
      throw new TypeError(`ExtractionResult emits conflicting facts for ${value.fact_ref}`);
    }
    byRef.set(value.fact_ref, previous ?? value);
  }
  return [...byRef.values()];
}

function semanticExtractionPayload(extraction: ExtractionResult): unknown {
  return {
    version: extraction.version,
    meta: {
      pluginId: extraction.meta.pluginId,
      commitHash: extraction.meta.commitHash,
      language: extraction.meta.language,
    },
    package: extraction.package,
    files: extraction.files,
    symbols: extraction.symbols,
    relations: extraction.relations,
    coverage: extraction.coverage,
    stats: extraction.stats,
  };
}

function relationSourceFile(
  relation: RelationInfo,
  symbols: readonly SymbolInfo[],
  filePaths: ReadonlySet<string>,
): string | null {
  if (filePaths.has(relation.from)) return relation.from;
  const candidates = symbols.filter((symbol) => symbol.name === relation.from);
  if (candidates.length === 1) return candidates[0]!.file;
  if (relation.line !== undefined) {
    const containing = candidates.filter((symbol) =>
      symbol.line <= relation.line! && symbol.endLine >= relation.line!
    );
    if (containing.length === 1) return containing[0]!.file;
  }
  return null;
}

function relationQualifiedItemPath(relation: RelationInfo): string {
  const identityDigest = indexerEvidenceAdapterProtocolDigest({
    from: relation.from,
    to: relation.to,
  });
  return `relation:${relation.type}@${relation.line ?? 0}#${identityDigest}`;
}

function diagnosticPayload(diagnostic: ExtractionDiagnostic): unknown {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    file: diagnostic.file,
    line: diagnostic.line,
    column: diagnostic.column,
  };
}

/**
 * Converts the legacy ExtractionResult v2 carrier into the common parser ABI.
 * Coverage is mandatory: silently treating a parser result as analyzed would
 * let unsupported files inflate the eligible-file and symbol denominators.
 */
export function extractionResultToEvidenceAdapterResult(
  extraction: ExtractionResult,
  invocation: ExtractionEvidenceAdapterInvocation,
): IndexerEvidenceAdapterResult {
  const coverage = extraction.coverage;
  if (!coverage) {
    throw new TypeError("ExtractionResult coverage is required for Evidence Adapter Result conversion");
  }
  if (coverage.capabilities.length === 0) {
    throw new TypeError("ExtractionResult coverage must declare at least one parser capability");
  }

  const coverageByPath = new Map(coverage.files.map((file) => [file.path, file]));
  const fileInfoByPath = new Map(extraction.files.map((file) => [file.path, file]));
  const filePaths = new Set([...coverageByPath.keys(), ...fileInfoByPath.keys()]);
  for (const file of extraction.files) {
    if (!coverageByPath.has(file.path)) {
      throw new TypeError(`ExtractionResult file ${file.path} has no coverage disposition`);
    }
  }
  for (const symbol of extraction.symbols) {
    const disposition = coverageByPath.get(symbol.file)?.disposition;
    if (disposition !== "analyzed") {
      throw new TypeError(
        `ExtractionResult symbol ${symbol.name} belongs to a file without analyzed disposition`,
      );
    }
  }

  const role = invocation.role ?? "primary-owner";
  const ownsDenominators = role === "primary-owner" && coverage.tier === "ast-catalog";
  const generatedDiagnostics: IndexerEvidenceAdapterResult["diagnostics"] = [];
  const relationsByFile = new Map<string, RelationInfo[]>();
  for (const relation of extraction.relations) {
    const file = relationSourceFile(relation, extraction.symbols, filePaths);
    if (file === null || coverageByPath.get(file)?.disposition !== "analyzed") {
      generatedDiagnostics.push({
        code: "relation-locator-unresolved",
        severity: "warning",
        detail_digest: indexerEvidenceAdapterProtocolDigest(relation),
      });
      continue;
    }
    const current = relationsByFile.get(file) ?? [];
    current.push(relation);
    relationsByFile.set(file, current);
  }

  const files = coverage.files.map((coverageFile) => {
    const normalizedPath = coverageFile.path;
    const fileRef = indexerEvidenceAdapterFileRef({
      source_ref: invocation.authorized_scope.source_ref,
      module_ref: invocation.module_ref,
      normalized_path: normalizedPath,
    });
    const fileInfo = fileInfoByPath.get(normalizedPath);
    if (coverageFile.disposition === "analyzed" && !fileInfo) {
      throw new TypeError(`Analyzed file ${normalizedPath} has no ExtractionResult file metadata`);
    }
    const facts: IndexerEvidenceAdapterFact[] = [];
    if (coverageFile.disposition === "analyzed" && fileInfo) {
      facts.push(fact({
        sourceRef: invocation.authorized_scope.source_ref,
        moduleRef: invocation.module_ref,
        normalizedPath,
        qualifiedItemPath: "file",
        kind: "source-file",
        signature: { path: normalizedPath, language: fileInfo.language },
        payload: fileInfo,
        denominator: ownsDenominators ? "eligible-file" : "none",
      }));
      facts.push(fact({
        sourceRef: invocation.authorized_scope.source_ref,
        moduleRef: invocation.module_ref,
        normalizedPath,
        qualifiedItemPath: "loc",
        kind: "source-loc",
        signature: { path: normalizedPath },
        payload: { lines: fileInfo.lines },
        denominator: ownsDenominators ? "loc" : "none",
      }));
      for (const symbol of extraction.symbols.filter((item) => item.file === normalizedPath)) {
        facts.push(fact({
          sourceRef: invocation.authorized_scope.source_ref,
          moduleRef: invocation.module_ref,
          normalizedPath,
          qualifiedItemPath: `symbol:${symbol.kind}:${symbol.name}@${symbol.line}`,
          kind: "code-symbol",
          signature: {
            name: symbol.name,
            kind: symbol.kind,
            signature: symbol.signature ?? null,
            params: symbol.params ?? null,
            returnType: symbol.returnType ?? null,
            typeAnnotation: symbol.typeAnnotation ?? null,
          },
          payload: symbol,
          denominator: ownsDenominators ? "symbol" : "none",
        }));
      }
      for (const relation of relationsByFile.get(normalizedPath) ?? []) {
        facts.push(fact({
          sourceRef: invocation.authorized_scope.source_ref,
          moduleRef: invocation.module_ref,
          normalizedPath,
          // A relation endpoint may be a whole top-level call expression. Keep
          // source text in the process-local, redacted payload rather than in
          // the durable locator carried by Result/Fact refs.
          qualifiedItemPath: relationQualifiedItemPath(relation),
          kind: "code-relation",
          signature: relation,
          payload: relation,
          denominator: "none",
        }));
      }
    }
    return {
      file_ref: fileRef,
      source_ref: invocation.authorized_scope.source_ref,
      module_ref: invocation.module_ref,
      normalized_path: normalizedPath,
      role,
      coverage_tier: coverage.tier,
      disposition: coverageFile.disposition,
      facts: uniqueFacts(facts),
    };
  });

  const diagnostics: IndexerEvidenceAdapterResult["diagnostics"] = [
    ...coverage.diagnostics.map((diagnostic) => {
      const coverageFile = coverageByPath.get(diagnostic.file);
      const fileRef = coverageFile
        ? indexerEvidenceAdapterFileRef({
            source_ref: invocation.authorized_scope.source_ref,
            module_ref: invocation.module_ref,
            normalized_path: diagnostic.file,
          })
        : undefined;
      return {
        code: diagnostic.code,
        severity: diagnostic.severity,
        detail_digest: indexerEvidenceAdapterProtocolDigest(diagnosticPayload(diagnostic)),
        ...(fileRef ? { fact_ref: fileRef } : {}),
      };
    }),
    ...generatedDiagnostics,
  ];
  const parserOutputDigest = indexerEvidenceAdapterProtocolDigest(
    semanticExtractionPayload(extraction),
  );
  return buildIndexerEvidenceAdapterResult({
    protocol: "context.indexer.evidence-adapter-result/v1",
    adapter: invocation.adapter,
    authorized_scope: invocation.authorized_scope,
    input_digest: invocation.input_digest,
    precedence: invocation.precedence,
    files,
    diagnostics,
    toolchain: [{
      step: "parse-source",
      package: invocation.adapter.package,
      export: invocation.adapter.export,
      version: invocation.adapter.version,
      digest: invocation.adapter.digest,
      capabilities: coverage.capabilities,
      input_digest: invocation.input_digest,
      output_digest: parserOutputDigest,
    }],
  });
}

/** Builds the wire result and its process-local structured fact payload sidecar. */
export function extractionResultToEvidenceAdapterMaterialization(
  extraction: ExtractionResult,
  invocation: ExtractionEvidenceAdapterInvocation,
): IndexerEvidenceAdapterMaterialization {
  return materializeIndexerEvidenceAdapterResult(
    extractionResultToEvidenceAdapterResult(extraction, invocation),
  );
}
