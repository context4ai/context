import { describe, expect, test } from "bun:test";
import {
  indexerEvidenceAdapterFactRef,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterOutputDigest,
  mergeIndexerEvidenceAdapterResults,
  validateIndexerEvidenceAdapterResult,
  type IndexerEvidenceAdapterResult,
} from "../index.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const SOURCE_REF = "repo:sample";
const MODULE_REF = "module:app";
const PATH = "src/index.ts";
const FILE_REF = indexerEvidenceAdapterFileRef({
  source_ref: SOURCE_REF,
  module_ref: MODULE_REF,
  normalized_path: PATH,
});
const LOCATOR = {
  source_ref: SOURCE_REF,
  module_ref: MODULE_REF,
  normalized_path: PATH,
  qualified_item_path: "export:run",
  signature_digest: DIGEST_B,
};
const FACT_REF = indexerEvidenceAdapterFactRef({
  ...LOCATOR,
  kind: "public-export",
});

function result(input: {
  adapterId?: string;
  role?: "primary-owner" | "enricher";
  tier?: "ast-catalog" | "lightweight-evidence";
  disposition?: "analyzed" | "unsupported" | "excluded";
  precedence?: number;
  payloadDigest?: string;
  denominator?: "none" | "eligible-file" | "loc" | "symbol" | "protocol-item";
} = {}): IndexerEvidenceAdapterResult {
  const disposition = input.disposition ?? "analyzed";
  const payload: Omit<IndexerEvidenceAdapterResult, "output_digest"> = {
    protocol: "context.indexer.evidence-adapter-result/v1",
    adapter: {
      id: input.adapterId ?? "extract-ts",
      package: "@c4a/extract-ts",
      export: "extract",
      version: "1.0.0",
      digest: DIGEST_A,
    },
    authorized_scope: {
      source_ref: SOURCE_REF,
      module_refs: [MODULE_REF],
      scope_digest: DIGEST_C,
    },
    input_digest: DIGEST_C,
    precedence: input.precedence ?? 10,
    files: [{
      file_ref: FILE_REF,
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: PATH,
      role: input.role ?? "primary-owner",
      coverage_tier: input.tier ?? "ast-catalog",
      disposition,
      facts: disposition === "analyzed"
        ? [{
            fact_ref: FACT_REF,
            kind: "public-export",
            locator: LOCATOR,
            payload_digest: input.payloadDigest ?? DIGEST_D,
            denominator: input.denominator ?? "none",
          }]
        : [],
    }],
    diagnostics: [],
    toolchain: [{
      step: "parse-source",
      package: "@c4a/extract-ts",
      export: "extract",
      version: "1.0.0",
      digest: DIGEST_A,
      capabilities: ["typescript-ast"],
      input_digest: DIGEST_C,
      output_digest: DIGEST_D,
    }],
  };
  return {
    ...payload,
    output_digest: indexerEvidenceAdapterOutputDigest(payload),
  };
}

describe("Evidence Adapter Result ABI", () => {
  test("validates canonical file/fact identity, scope, toolchain, and output digest", () => {
    expect(validateIndexerEvidenceAdapterResult(result())).toEqual(result());
  });

  test("keeps lightweight and enricher facts out of AST and symbol denominators", () => {
    expect(() => validateIndexerEvidenceAdapterResult(result({
      tier: "lightweight-evidence",
      denominator: "symbol",
    }))).toThrow(/cannot contribute denominators/);
    expect(() => validateIndexerEvidenceAdapterResult(result({
      role: "enricher",
      denominator: "eligible-file",
    }))).toThrow(/cannot contribute denominators/);
  });

  test("rejects facts on unsupported files and forged canonical identities", () => {
    const unsupported = result();
    unsupported.files[0]!.disposition = "unsupported";
    expect(() => validateIndexerEvidenceAdapterResult(unsupported)).toThrow(/cannot publish facts/);

    const forged = result();
    forged.files[0]!.file_ref = "adapter-file:forged";
    expect(() => validateIndexerEvidenceAdapterResult(forged)).toThrow(/non-canonical identity/);
  });

  test("merges one primary owner with deterministic higher-precedence enrichment", () => {
    const primary = result({ precedence: 10, payloadDigest: DIGEST_A });
    const enricher = result({
      adapterId: "config-evidence",
      role: "enricher",
      tier: "lightweight-evidence",
      precedence: 20,
      payloadDigest: DIGEST_B,
    });
    const merged = mergeIndexerEvidenceAdapterResults({
      results: [enricher, primary],
      eligible_file_refs: [FILE_REF],
    });
    expect(merged.primary_owners).toEqual([{
      file_ref: FILE_REF,
      adapter_id: "extract-ts",
      coverage_tier: "ast-catalog",
    }]);
    expect(merged.facts[0]).toMatchObject({
      fact_ref: FACT_REF,
      adapter_id: "config-evidence",
      precedence: 20,
      payload_digest: DIGEST_B,
    });
    expect(merged.conflicts[0]).toEqual({
      fact_ref: FACT_REF,
      winner_adapter_id: "config-evidence",
      shadowed_adapter_ids: ["extract-ts"],
    });
  });

  test("rejects missing/duplicate primary owner and equal-precedence conflict", () => {
    expect(() => mergeIndexerEvidenceAdapterResults({
      results: [result({ role: "enricher" })],
      eligible_file_refs: [FILE_REF],
    })).toThrow(/exactly one primary owner/);
    expect(() => mergeIndexerEvidenceAdapterResults({
      results: [result(), result({ adapterId: "other-parser" })],
      eligible_file_refs: [FILE_REF],
    })).toThrow(/exactly one primary owner/);
    expect(() => mergeIndexerEvidenceAdapterResults({
      results: [
        result({ payloadDigest: DIGEST_A }),
        result({
          adapterId: "other-parser",
          role: "enricher",
          payloadDigest: DIGEST_B,
        }),
      ],
      eligible_file_refs: [FILE_REF],
    })).toThrow(/equal-precedence conflict/);
  });

  test("rejects denominator conflicts even when precedence differs", () => {
    expect(() => mergeIndexerEvidenceAdapterResults({
      results: [
        result({ denominator: "symbol" }),
        result({
          adapterId: "other-parser",
          role: "enricher",
          precedence: 20,
          denominator: "none",
        }),
      ],
      eligible_file_refs: [FILE_REF],
    })).toThrow(/denominator authority/);
  });
});
