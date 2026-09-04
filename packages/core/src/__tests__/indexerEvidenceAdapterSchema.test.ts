import { describe, expect, test } from "bun:test";
import {
  buildIndexerEvidenceAdapterResult,
  createIndexerEvidenceAdapterFact,
  indexerEvidenceAdapterFactPayloads,
  indexerEvidenceAdapterFactRef,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterOutputDigest,
  indexerEvidenceAdapterProtocolDigest,
  materializeIndexerEvidenceAdapterResult,
} from "../index.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;

describe("parser-side Evidence Adapter Result wire schema", () => {
  test("canonicalizes set-like fields and seals the output digest", () => {
    const sourceRef = "repo:sample";
    const moduleRef = "module:z";
    const normalizedPath = "src/index.ts";
    const fileRef = indexerEvidenceAdapterFileRef({
      source_ref: sourceRef,
      module_ref: moduleRef,
      normalized_path: normalizedPath,
    });
    const locator = {
      source_ref: sourceRef,
      module_ref: moduleRef,
      normalized_path: normalizedPath,
      qualified_item_path: "symbol:run@1",
      signature_digest: DIGEST_B,
    };
    const factRef = indexerEvidenceAdapterFactRef({
      ...locator,
      kind: "code-symbol",
    });
    const result = buildIndexerEvidenceAdapterResult({
      protocol: "context.indexer.evidence-adapter-result/v1",
      adapter: {
        id: "extract-ts",
        package: "@c4a/extract-ts",
        export: "toEvidenceAdapterResult",
        version: "0.7.0",
        digest: DIGEST_A,
      },
      authorized_scope: {
        source_ref: sourceRef,
        module_refs: [moduleRef, "module:a"],
        scope_digest: DIGEST_C,
      },
      input_digest: DIGEST_C,
      precedence: 10,
      files: [{
        file_ref: fileRef,
        source_ref: sourceRef,
        module_ref: moduleRef,
        normalized_path: normalizedPath,
        role: "primary-owner",
        coverage_tier: "ast-catalog",
        disposition: "analyzed",
        facts: [{
          fact_ref: factRef,
          kind: "code-symbol",
          locator,
          payload_digest: DIGEST_A,
          denominator: "symbol",
        }],
      }],
      diagnostics: [],
      toolchain: [{
        step: "parse-source",
        package: "@c4a/extract-ts",
        export: "toEvidenceAdapterResult",
        version: "0.7.0",
        digest: DIGEST_A,
        capabilities: ["typescript-ast", "parser.typescript"],
        input_digest: DIGEST_C,
        output_digest: DIGEST_B,
      }],
    });

    expect(result.authorized_scope.module_refs).toEqual(["module:a", "module:z"]);
    expect(result.toolchain[0]?.capabilities).toEqual([
      "parser.typescript",
      "typescript-ast",
    ]);
    const { output_digest: outputDigest, ...payload } = result;
    expect(outputDigest).toBe(indexerEvidenceAdapterOutputDigest(payload));
  });

  test("uses Context-compatible canonical object-key ordering", () => {
    expect(indexerEvidenceAdapterProtocolDigest({ z: 1, _a: 2, a: 3 })).toBe(
      indexerEvidenceAdapterProtocolDigest({ a: 3, z: 1, _a: 2 }),
    );
  });

  test("rejects lightweight denominator claims before a parser publishes them", () => {
    expect(() => buildIndexerEvidenceAdapterResult({
      protocol: "context.indexer.evidence-adapter-result/v1",
      adapter: {
        id: "config-evidence",
        package: "@c4a/extract-config",
        export: "extract",
        version: "0.7.0",
        digest: DIGEST_A,
      },
      authorized_scope: {
        source_ref: "repo:sample",
        module_refs: [],
        scope_digest: DIGEST_B,
      },
      input_digest: DIGEST_B,
      precedence: 1,
      files: [{
        file_ref: indexerEvidenceAdapterFileRef({
          source_ref: "repo:sample",
          module_ref: null,
          normalized_path: "config.yaml",
        }),
        source_ref: "repo:sample",
        module_ref: null,
        normalized_path: "config.yaml",
        role: "primary-owner",
        coverage_tier: "lightweight-evidence",
        disposition: "analyzed",
        facts: [{
          fact_ref: "adapter-fact:forged",
          kind: "config-key",
          locator: {
            source_ref: "repo:sample",
            module_ref: null,
            normalized_path: "config.yaml",
            qualified_item_path: "key:server.port",
            signature_digest: DIGEST_A,
          },
          payload_digest: DIGEST_C,
          denominator: "symbol",
        }],
      }],
      diagnostics: [],
      toolchain: [{
        step: "parse-config",
        package: "@c4a/extract-config",
        export: "extract",
        version: "0.7.0",
        digest: DIGEST_A,
        capabilities: ["config-evidence"],
        input_digest: DIGEST_B,
        output_digest: DIGEST_C,
      }],
    })).toThrow(/cannot contribute denominators/);
  });

  test("blocks secret-bearing output from every adapter using the common builder", () => {
    const normalizedPath = "config/token=fixture-secret-do-not-emit.yaml";
    expect(() => buildIndexerEvidenceAdapterResult({
      protocol: "context.indexer.evidence-adapter-result/v1",
      adapter: {
        id: "fixture-adapter",
        package: "@c4a/extract",
        export: "fixture",
        version: "0.7.0",
        digest: DIGEST_A,
      },
      authorized_scope: {
        source_ref: "repo:sample",
        module_refs: [],
        scope_digest: DIGEST_B,
      },
      input_digest: DIGEST_B,
      precedence: 1,
      files: [{
        file_ref: indexerEvidenceAdapterFileRef({
          source_ref: "repo:sample",
          module_ref: null,
          normalized_path: normalizedPath,
        }),
        source_ref: "repo:sample",
        module_ref: null,
        normalized_path: normalizedPath,
        role: "primary-owner",
        coverage_tier: "lightweight-evidence",
        disposition: "analyzed",
        facts: [],
      }],
      diagnostics: [],
      toolchain: [{
        step: "parse-fixture",
        package: "@c4a/extract",
        export: "fixture",
        version: "0.7.0",
        digest: DIGEST_A,
        capabilities: ["fixture-parser"],
        input_digest: DIGEST_B,
        output_digest: DIGEST_C,
      }],
    })).toThrow("blocked by the common output redaction boundary");
  });

  test("materializes structured fact payloads only while the wire result remains in process", () => {
    const fact = createIndexerEvidenceAdapterFact({
      source_ref: "repo:sample",
      module_ref: null,
      normalized_path: "src/index.ts",
      qualified_item_path: "symbol:function:run@1",
      kind: "code-symbol",
      signature: { kind: "function", name: "run" },
      payload: { exported: true, kind: "function", name: "run" },
      denominator: "symbol",
    });
    const result = buildIndexerEvidenceAdapterResult({
      protocol: "context.indexer.evidence-adapter-result/v1",
      adapter: {
        id: "fixture-adapter",
        package: "@c4a/extract",
        export: "fixture",
        version: "0.7.0",
        digest: DIGEST_A,
      },
      authorized_scope: {
        source_ref: "repo:sample",
        module_refs: [],
        scope_digest: DIGEST_B,
      },
      input_digest: DIGEST_B,
      precedence: 1,
      files: [{
        file_ref: indexerEvidenceAdapterFileRef({
          source_ref: "repo:sample",
          module_ref: null,
          normalized_path: "src/index.ts",
        }),
        source_ref: "repo:sample",
        module_ref: null,
        normalized_path: "src/index.ts",
        role: "primary-owner",
        coverage_tier: "ast-catalog",
        disposition: "analyzed",
        facts: [fact],
      }],
      diagnostics: [],
      toolchain: [{
        step: "parse-fixture",
        package: "@c4a/extract",
        export: "fixture",
        version: "0.7.0",
        digest: DIGEST_A,
        capabilities: ["fixture-parser"],
        input_digest: DIGEST_B,
        output_digest: DIGEST_C,
      }],
    });

    expect(materializeIndexerEvidenceAdapterResult(result)).toEqual({
      result,
      fact_payloads: [{
        fact_ref: fact.fact_ref,
        payload: { exported: true, kind: "function", name: "run" },
      }],
    });
    expect(JSON.stringify(result)).not.toContain('"payload"');
    const roundTripped = JSON.parse(JSON.stringify(result));
    expect(() => indexerEvidenceAdapterFactPayloads(roundTripped)).toThrow(
      /no longer materialized in this process/u,
    );
  });

  test("applies the common secret boundary when materializing a fact payload", () => {
    const fact = createIndexerEvidenceAdapterFact({
      source_ref: "repo:sample",
      module_ref: null,
      normalized_path: "src/index.ts",
      qualified_item_path: "configuration",
      kind: "configuration",
      signature: { kind: "configuration" },
      payload: { access_token: "fixture-secret-do-not-emit" },
      denominator: "none",
    });
    const result = buildIndexerEvidenceAdapterResult({
      protocol: "context.indexer.evidence-adapter-result/v1",
      adapter: {
        id: "fixture-adapter",
        package: "@c4a/extract",
        export: "fixture",
        version: "0.7.0",
        digest: DIGEST_A,
      },
      authorized_scope: {
        source_ref: "repo:sample",
        module_refs: [],
        scope_digest: DIGEST_B,
      },
      input_digest: DIGEST_B,
      precedence: 1,
      files: [{
        file_ref: indexerEvidenceAdapterFileRef({
          source_ref: "repo:sample",
          module_ref: null,
          normalized_path: "src/index.ts",
        }),
        source_ref: "repo:sample",
        module_ref: null,
        normalized_path: "src/index.ts",
        role: "enricher",
        coverage_tier: "lightweight-evidence",
        disposition: "analyzed",
        facts: [fact],
      }],
      diagnostics: [],
      toolchain: [{
        step: "parse-fixture",
        package: "@c4a/extract",
        export: "fixture",
        version: "0.7.0",
        digest: DIGEST_A,
        capabilities: ["fixture-parser"],
        input_digest: DIGEST_B,
        output_digest: DIGEST_C,
      }],
    });

    expect(() => materializeIndexerEvidenceAdapterResult(result)).toThrow(
      "blocked by the common output redaction boundary",
    );
  });

  test("rejects lossy or non-canonical fact payload values", () => {
    const base = {
      source_ref: "repo:sample",
      module_ref: null,
      normalized_path: "src/index.ts",
      qualified_item_path: "configuration",
      kind: "configuration",
      signature: { kind: "configuration" },
      denominator: "none" as const,
    };
    expect(() => createIndexerEvidenceAdapterFact({
      ...base,
      payload: { omitted: undefined },
    })).toThrow(/only JSON values/u);
    expect(() => createIndexerEvidenceAdapterFact({
      ...base,
      payload: { invalid: Number.NaN },
    })).toThrow(/finite/u);
    expect(() => createIndexerEvidenceAdapterFact({
      ...base,
      payload: new Date("2026-08-28T00:00:00.000Z"),
    })).toThrow(/plain JSON objects/u);
  });

});
