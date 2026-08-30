import { describe, expect, test } from "bun:test";
import {
  buildIndexerParserFactView,
  buildIndexerParserFactViewFromMaterializations,
  indexerEvidenceAdapterFactRef,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterOutputDigest,
  indexerProtocolDigest,
  validateIndexerParserFactView,
  type IndexerEvidenceAdapterResult,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SOURCE_REF = "repo:sample";
const MODULE_REF = "module:app";
const PATH = "src/config.json";
const FILE_REF = indexerEvidenceAdapterFileRef({
  source_ref: SOURCE_REF,
  module_ref: MODULE_REF,
  normalized_path: PATH,
});
const PAYLOAD = {
  key_path: "runtime.mode",
  value_type: "string",
  classification: "public-identifier",
  normalized_value: "server",
};
const LOCATOR = {
  source_ref: SOURCE_REF,
  module_ref: MODULE_REF,
  normalized_path: PATH,
  qualified_item_path: "runtime.mode",
  signature_digest: indexerProtocolDigest({ key_path: "runtime.mode" }),
};
const FACT_REF = indexerEvidenceAdapterFactRef({ ...LOCATOR, kind: "config-value" });

function adapterResult(): IndexerEvidenceAdapterResult {
  const scope = {
    source_ref: SOURCE_REF,
    module_refs: [MODULE_REF],
    scope_digest: indexerProtocolDigest({
      source_ref: SOURCE_REF,
      module_refs: [MODULE_REF],
    }),
  };
  const base: Omit<IndexerEvidenceAdapterResult, "output_digest"> = {
    protocol: "context.indexer.evidence-adapter-result/v1",
    adapter: {
      id: "sample-config-parser",
      package: "@example/config-parser",
      export: "parse",
      version: "1.2.3",
      digest: digest("1"),
    },
    authorized_scope: scope,
    input_digest: digest("2"),
    precedence: 10,
    files: [{
      file_ref: FILE_REF,
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: PATH,
      role: "primary-owner",
      coverage_tier: "lightweight-evidence",
      disposition: "analyzed",
      facts: [{
        fact_ref: FACT_REF,
        kind: "config-value",
        locator: LOCATOR,
        payload_digest: indexerProtocolDigest(PAYLOAD),
        denominator: "none",
      }],
    }],
    diagnostics: [],
    toolchain: [{
      step: "parse-config",
      package: "@example/config-parser",
      export: "parse",
      version: "1.2.3",
      digest: digest("1"),
      capabilities: ["parser.json"],
      input_digest: digest("2"),
      output_digest: digest("3"),
    }],
  };
  return { ...base, output_digest: indexerEvidenceAdapterOutputDigest(base) };
}

describe("ephemeral parser fact view", () => {
  test("materializes exact parser payloads into a scope-bound canonical IPC view", () => {
    const view = buildIndexerParserFactViewFromMaterializations({
      materializations: [{
        result: adapterResult(),
        fact_payloads: [{ fact_ref: FACT_REF, payload: PAYLOAD }],
      }],
      inventory_digest: digest("4"),
    });
    expect(validateIndexerParserFactView(view)).toEqual(view);
    expect(view).toMatchObject({
      protocol: "context.indexer.parser-fact-view/v1",
      authorized_scope: { source_ref: SOURCE_REF, module_refs: [MODULE_REF] },
      files: [{
        file_ref: FILE_REF,
        facts: [{ fact_ref: FACT_REF, payload: PAYLOAD }],
      }],
    });
  });

  test("rejects missing, forged, extra, and out-of-view fact payloads", () => {
    const result = adapterResult();
    expect(() => buildIndexerParserFactView({
      adapter_results: [result],
      fact_payloads: [],
      inventory_digest: digest("4"),
    })).toThrow(/unavailable/);
    expect(() => buildIndexerParserFactView({
      adapter_results: [result],
      fact_payloads: [{ fact_ref: FACT_REF, payload: { ...PAYLOAD, normalized_value: "client" } }],
      inventory_digest: digest("4"),
    })).toThrow(/does not match/);
    expect(() => buildIndexerParserFactView({
      adapter_results: [result],
      fact_payloads: [
        { fact_ref: FACT_REF, payload: PAYLOAD },
        { fact_ref: "fact:unregistered", payload: null },
      ],
      inventory_digest: digest("4"),
    })).toThrow(/outside the selected view/);

    const view = buildIndexerParserFactView({
      adapter_results: [result],
      fact_payloads: [{ fact_ref: FACT_REF, payload: PAYLOAD }],
      inventory_digest: digest("4"),
    });
    const forged = structuredClone(view);
    forged.files[0]!.facts[0]!.payload = { ...PAYLOAD, normalized_value: "forged" };
    expect(() => validateIndexerParserFactView(forged)).toThrow(/payload digest/);
  });
});
