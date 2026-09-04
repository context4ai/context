import { describe, expect, test } from "bun:test";
import {
  EdgeType,
  EdgeSource,
  Grounding,
  indexerEvidenceAdapterProtocolDigest,
  PackageKind,
  SymbolKind,
  Visibility,
} from "@c4a/core";
import {
  extractionResultToEvidenceAdapterMaterialization,
  extractionResultToEvidenceAdapterResult,
  type ExtractionResult,
} from "../index.js";
import { validateIndexerEvidenceAdapterResult } from "../../../context/src/indexerEvidenceAdapterResult.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function extraction(tier: "ast-catalog" | "lightweight-evidence" = "ast-catalog"): ExtractionResult {
  return {
    version: "2",
    meta: {
      extractedAt: "2026-08-28T00:00:00.000Z",
      pluginId: "sample-parser",
      commitHash: "abc123",
      language: "typescript",
    },
    package: {
      name: "sample",
      kind: PackageKind.Lib,
      language: "typescript",
    },
    files: [{ path: "src/index.ts", language: "typescript", lines: 4 }],
    symbols: [{
      name: "run",
      kind: SymbolKind.Function,
      visibility: Visibility.Exported,
      file: "src/index.ts",
      line: 1,
      endLine: 3,
      signature: "run(): void",
    }],
    relations: [],
    coverage: {
      tier,
      capabilities: ["parser.typescript"],
      files: [
        { path: "src/index.ts", disposition: "analyzed", diagnosticCodes: [] },
        { path: "src/dynamic.cjs", disposition: "unsupported", diagnosticCodes: ["dynamic-require"] },
      ],
      diagnostics: [{
        code: "dynamic-require",
        severity: "error",
        file: "src/dynamic.cjs",
        line: 1,
        column: 1,
      }],
    },
    stats: {
      files: 1,
      lines: 4,
      exportedSymbols: 1,
      internalSymbols: 0,
      relations: 0,
    },
  };
}

function invocation(role: "primary-owner" | "enricher" = "primary-owner") {
  return {
    adapter: {
      id: "sample-parser",
      package: "@c4a/extract-sample",
      export: "extract",
      version: "0.7.0",
      digest: DIGEST_A,
    },
    authorized_scope: {
      source_ref: "repo:sample",
      module_refs: ["module:sample"],
      scope_digest: DIGEST_B,
    },
    module_ref: "module:sample",
    input_digest: DIGEST_B,
    precedence: 10,
    role,
  };
}

describe("ExtractionResult Evidence ABI adapter", () => {
  test("publishes a Context-valid primary-owner result with explicit denominators", () => {
    const materialized = extractionResultToEvidenceAdapterMaterialization(
      extraction(),
      invocation(),
    );
    const result = materialized.result;
    expect(validateIndexerEvidenceAdapterResult(result)).toEqual(result);
    expect(result.files.map((file) => file.disposition)).toEqual(["analyzed", "unsupported"]);
    expect(result.files.find((file) => file.disposition === "unsupported")?.facts).toEqual([]);
    expect(result.files.flatMap((file) => file.facts).map((item) => item.denominator).sort()).toEqual([
      "eligible-file",
      "loc",
      "symbol",
    ]);
    expect(materialized.fact_payloads).toHaveLength(3);
    for (const item of materialized.fact_payloads) {
      const descriptor = result.files.flatMap((file) => file.facts)
        .find((fact) => fact.fact_ref === item.fact_ref);
      expect(descriptor?.payload_digest).toBe(
        indexerEvidenceAdapterProtocolDigest(item.payload),
      );
    }
  });

  test("keeps lightweight and enricher output outside all denominators", () => {
    const lightweight = extractionResultToEvidenceAdapterResult(
      extraction("lightweight-evidence"),
      invocation(),
    );
    const enricher = extractionResultToEvidenceAdapterResult(extraction(), invocation("enricher"));
    expect(lightweight.files.flatMap((file) => file.facts).every((item) => item.denominator === "none")).toBe(true);
    expect(enricher.files.flatMap((file) => file.facts).every((item) => item.denominator === "none")).toBe(true);
    expect(validateIndexerEvidenceAdapterResult(lightweight)).toEqual(lightweight);
    expect(validateIndexerEvidenceAdapterResult(enricher)).toEqual(enricher);
  });

  test("keeps file-level import and top-level call relations", () => {
    const current = extraction();
    current.relations = [{
      from: "src/index.ts",
      to: "./dependency.js",
      type: EdgeType.Imports,
      isExternal: false,
      grounding: Grounding.Code,
      confidence: 1,
      source: EdgeSource.Ast,
      line: 1,
    }, {
      from: "src/index.ts",
      to: "bootstrap",
      type: EdgeType.Calls,
      isExternal: false,
      grounding: Grounding.Code,
      confidence: 1,
      source: EdgeSource.Ast,
      line: 4,
    }];
    current.stats.relations = current.relations.length;
    const result = extractionResultToEvidenceAdapterResult(current, invocation());
    expect(result.files[0]!.facts.filter((item) => item.kind === "code-relation"))
      .toHaveLength(2);
    expect(result.diagnostics.some((item) => item.code === "relation-locator-unresolved"))
      .toBe(false);
  });

  test("keeps source expressions out of durable relation locators", () => {
    const current = extraction();
    const expression = "fetch('/session').then((value) => value.access_token)";
    current.relations = [{
      from: "src/index.ts",
      to: expression,
      type: EdgeType.Calls,
      isExternal: false,
      grounding: Grounding.Code,
      confidence: 1,
      source: EdgeSource.Ast,
      line: 2,
    }];
    current.stats.relations = 1;

    const materialized = extractionResultToEvidenceAdapterMaterialization(
      current,
      invocation(),
    );
    const relation = materialized.result.files[0]!.facts.find((item) =>
      item.kind === "code-relation"
    );
    expect(relation?.locator.qualified_item_path).toMatch(
      /^relation:calls@2#sha256:[a-f0-9]{64}$/u,
    );
    expect(relation?.locator.qualified_item_path).not.toContain(expression);
    expect(materialized.fact_payloads.find((item) => item.fact_ref === relation?.fact_ref))
      .toBeDefined();
  });

  test("rejects legacy extraction output without per-file coverage", () => {
    const legacy = extraction();
    Reflect.deleteProperty(legacy, "coverage");
    expect(() => extractionResultToEvidenceAdapterResult(legacy, invocation())).toThrow(
      /coverage is required/,
    );
  });
});
