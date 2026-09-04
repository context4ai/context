import { describe, expect, test } from "bun:test";
import {
  buildIndexerSourceIdentityInventory,
  buildIndexerSourceIdentityInventoryFromAdapterResults,
  buildIndexerStructuredDeclarationSet,
  indexerEvidenceAdapterFactRef,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterOutputDigest,
  indexerSectionEvidenceCarrierRef,
  projectIndexerSourceIdentityInventory,
  validateIndexerStructuredDeclarationSet,
  type IndexerEvidenceAdapterResult,
  type IndexerStructuredDeclarationPayload,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SOURCE_REF = "repo:sample@revision";
const MODULE_REF = "module:sample";
const EVIDENCE_REF = "evidence:source-catalog";
const RESULT_REF = "result:sample";
const CATALOG_REF = "catalog:routes";
const STORE_CATALOG_REF = "catalog:stores";
const MANIFEST_REF = "manifest:service";
const SECTION_REF = indexerSectionEvidenceCarrierRef({
  logical_unit_ref: "node:sample",
  artifact_id: "service-overview",
  section_key: "handlers",
});

function adapterResult(role: "primary-owner" | "enricher" = "primary-owner") {
  const normalizedPath = "api/service.proto";
  const locator = {
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    normalized_path: normalizedPath,
    qualified_item_path: "service:ExampleService/method:GetExample",
    signature_digest: digest("3"),
  };
  const payload: Omit<IndexerEvidenceAdapterResult, "output_digest"> = {
    protocol: "context.indexer.evidence-adapter-result/v1",
    adapter: {
      id: role === "primary-owner" ? "protocol-parser" : "protocol-enricher",
      package: "@c4a/extract-proto",
      export: "protoSourcesToEvidenceAdapterResult",
      version: "0.7.0",
      digest: digest("8"),
    },
    authorized_scope: {
      source_ref: SOURCE_REF,
      module_refs: [MODULE_REF],
      scope_digest: digest("9"),
    },
    input_digest: digest("a"),
    precedence: role === "primary-owner" ? 10 : 20,
    files: [{
      file_ref: indexerEvidenceAdapterFileRef({
        source_ref: SOURCE_REF,
        module_ref: MODULE_REF,
        normalized_path: normalizedPath,
      }),
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: normalizedPath,
      role,
      coverage_tier: "ast-catalog",
      disposition: "analyzed",
      facts: [{
        fact_ref: indexerEvidenceAdapterFactRef({
          ...locator,
          kind: "protocol-method",
        }),
        kind: "protocol-method",
        locator,
        payload_digest: digest("b"),
        denominator: role === "primary-owner" ? "protocol-item" : "none",
      }],
    }],
    diagnostics: [],
    toolchain: [{
      step: "parse-protocol",
      package: "@c4a/extract-proto",
      export: "protoSourcesToEvidenceAdapterResult",
      version: "0.7.0",
      digest: digest("8"),
      capabilities: ["parser.proto"],
      input_digest: digest("a"),
      output_digest: digest("c"),
    }],
  };
  return {
    ...payload,
    output_digest: indexerEvidenceAdapterOutputDigest(payload),
  };
}

const inventory = buildIndexerSourceIdentityInventory({
  source_ref: SOURCE_REF,
  module_ref: MODULE_REF,
  source_input_digest: digest("1"),
  files: [{
    normalized_path: "api/service.proto",
    content_digest: digest("2"),
    facts: [{
      fact_ref: "source-fact:service-method",
      fact_kind: "protocol-method",
      qualified_item_path: "service:ExampleService/method:GetExample",
      signature_digest: digest("3"),
    }],
  }, {
    normalized_path: "src/handler.ts",
    content_digest: digest("4"),
    facts: [{
      fact_ref: "source-fact:request-handler",
      fact_kind: "code-symbol",
      qualified_item_path: "symbol:function:handleRequest@12",
      signature_digest: digest("5"),
    }],
  }, {
    normalized_path: "src/store.ts",
    content_digest: digest("6"),
    facts: [{
      fact_ref: "source-fact:record-store",
      fact_kind: "code-symbol",
      qualified_item_path: "symbol:class:RecordStore@8",
      signature_digest: digest("7"),
    }],
  }],
});

function declarations(): IndexerStructuredDeclarationPayload[] {
  return [{
    carrier_kind: "indexer-result",
    carrier_ref: RESULT_REF,
    declaration_kind: "directory",
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    target: { target_type: "directory", normalized_path: "src" },
    evidence_refs: [EVIDENCE_REF],
  }, {
    carrier_kind: "catalog",
    carrier_ref: CATALOG_REF,
    declaration_kind: "entry",
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    target: {
      target_type: "file",
      normalized_path: "src/handler.ts",
      content_digest: digest("4"),
    },
    evidence_refs: [EVIDENCE_REF],
  }, {
    carrier_kind: "manifest",
    carrier_ref: MANIFEST_REF,
    declaration_kind: "method",
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    target: {
      target_type: "item",
      normalized_path: "api/service.proto",
      source_fact_ref: "source-fact:service-method",
      qualified_item_path: "service:ExampleService/method:GetExample",
      signature_digest: digest("3"),
    },
    evidence_refs: [EVIDENCE_REF],
  }, {
    carrier_kind: "section-evidence",
    carrier_ref: SECTION_REF,
    declaration_kind: "handler",
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    target: {
      target_type: "item",
      normalized_path: "src/handler.ts",
      source_fact_ref: "source-fact:request-handler",
      qualified_item_path: "symbol:function:handleRequest@12",
      signature_digest: digest("5"),
    },
    evidence_refs: [EVIDENCE_REF],
  }, {
    carrier_kind: "catalog",
    carrier_ref: STORE_CATALOG_REF,
    declaration_kind: "store",
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    target: {
      target_type: "item",
      normalized_path: "src/store.ts",
      source_fact_ref: "source-fact:record-store",
      qualified_item_path: "symbol:class:RecordStore@8",
      signature_digest: digest("7"),
    },
    evidence_refs: [EVIDENCE_REF],
  }, {
    carrier_kind: "indexer-result",
    carrier_ref: RESULT_REF,
    declaration_kind: "locator",
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    target: {
      target_type: "item",
      normalized_path: "src/handler.ts",
      source_fact_ref: "source-fact:request-handler",
      qualified_item_path: "symbol:function:handleRequest@12",
      signature_digest: digest("5"),
    },
    evidence_refs: [EVIDENCE_REF],
  }];
}

function validate(values: readonly IndexerStructuredDeclarationPayload[] = declarations()) {
  return validateIndexerStructuredDeclarationSet({
    value: buildIndexerStructuredDeclarationSet({
      source_identity_inventory_digest: inventory.inventory_digest,
      declarations: values,
    }),
    source_identity_inventory: inventory,
    expected_source_ref: SOURCE_REF,
    expected_module_ref: MODULE_REF,
    carrier_authority: {
      "indexer-result": [RESULT_REF],
      catalog: [CATALOG_REF, STORE_CATALOG_REF],
      manifest: [MANIFEST_REF],
      "section-evidence": [SECTION_REF],
    },
    known_evidence_refs: [EVIDENCE_REF],
  });
}

describe("structured source declaration existence", () => {
  test("projects source identity to the exact facts authorized for one workset", () => {
    const projected = projectIndexerSourceIdentityInventory({
      inventory,
      fact_refs: ["source-fact:request-handler"],
    });
    expect(projected.files).toEqual([{
      normalized_path: "src/handler.ts",
      content_digest: digest("4"),
      facts: [{
        fact_ref: "source-fact:request-handler",
        fact_kind: "code-symbol",
        qualified_item_path: "symbol:function:handleRequest@12",
        signature_digest: digest("5"),
      }],
    }]);
    expect(() => projectIndexerSourceIdentityInventory({
      inventory,
      fact_refs: ["source-fact:missing"],
    })).toThrow(/unknown facts/);
  });

  test("derives the source inventory from validated parser facts and unique ownership", () => {
    const result = adapterResult();
    const value = buildIndexerSourceIdentityInventoryFromAdapterResults({
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      source_input_digest: digest("a"),
      file_content_digests: { "api/service.proto": digest("2") },
      results: [result],
    });
    expect(value.files[0]).toMatchObject({
      normalized_path: "api/service.proto",
      facts: [{
        fact_kind: "protocol-method",
        qualified_item_path: "service:ExampleService/method:GetExample",
      }],
    });
    expect(() => buildIndexerSourceIdentityInventoryFromAdapterResults({
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      source_input_digest: digest("a"),
      file_content_digests: { "api/service.proto": digest("2") },
      results: [result, adapterResult()],
    })).toThrow(/exactly one primary owner/);
    expect(() => buildIndexerSourceIdentityInventoryFromAdapterResults({
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      source_input_digest: digest("a"),
      file_content_digests: {},
      results: [result],
    })).toThrow(/lacks content digest/);
  });

  test("binds every carrier and declaration kind to the current source identity", () => {
    const value = validate([...declarations()].reverse());
    expect(value.declarations).toHaveLength(6);
    expect(value.declarations.map((item) => item.carrier_kind).sort()).toEqual([
      "catalog",
      "catalog",
      "indexer-result",
      "indexer-result",
      "manifest",
      "section-evidence",
    ]);
  });

  test("rejects missing or stale directories, files, and exact source items", () => {
    const missingDirectory = declarations();
    missingDirectory[0] = {
      ...missingDirectory[0]!,
      target: { target_type: "directory", normalized_path: "missing" },
    };
    expect(() => validate(missingDirectory)).toThrow(/directory .* does not exist/);

    const staleFile = declarations();
    const entry = staleFile[1]!;
    staleFile[1] = {
      ...entry,
      target: {
        target_type: "file",
        normalized_path: "src/handler.ts",
        content_digest: digest("f"),
      },
    };
    expect(() => validate(staleFile)).toThrow(/content identity is stale/);

    const missingItem = declarations();
    const method = missingItem[2]!;
    if (method.target.target_type !== "item") throw new Error("expected item target");
    missingItem[2] = {
      ...method,
      target: { ...method.target, signature_digest: digest("f") },
    };
    expect(() => validate(missingItem)).toThrow(/source item does not exist/);

    const missingSectionEntry = declarations();
    const sectionEntry = missingSectionEntry[3]!;
    if (sectionEntry.target.target_type !== "item") {
      throw new Error("expected Section evidence item target");
    }
    missingSectionEntry[3] = {
      ...sectionEntry,
      target: {
        ...sectionEntry.target,
        qualified_item_path: "symbol:function:missingHandler@12",
      },
    };
    expect(() => validate(missingSectionEntry)).toThrow(/source item does not exist/);
  });

  test("rejects carrier, evidence, source, and target-shape authority drift", () => {
    const carrierDrift = declarations();
    carrierDrift[0] = { ...carrierDrift[0]!, carrier_ref: "result:other" };
    expect(() => validate(carrierDrift)).toThrow(/unauthorized carrier/);

    const evidenceDrift = declarations();
    evidenceDrift[0] = { ...evidenceDrift[0]!, evidence_refs: ["evidence:other"] };
    expect(() => validate(evidenceDrift)).toThrow(/unknown evidence/);

    const sourceDrift = declarations();
    sourceDrift[0] = { ...sourceDrift[0]!, source_ref: "repo:other@revision" };
    expect(() => validate(sourceDrift)).toThrow(/escapes current source/);

    const invalidMethod = declarations();
    invalidMethod[2] = {
      ...invalidMethod[2]!,
      target: {
        target_type: "file",
        normalized_path: "api/service.proto",
        content_digest: digest("2"),
      },
    };
    expect(() => validate(invalidMethod)).toThrow(/requires an exact source item/);
  });

  test("rejects aliases and prose-shaped fields instead of scanning them", () => {
    const value = buildIndexerStructuredDeclarationSet({
      source_identity_inventory_digest: inventory.inventory_digest,
      declarations: declarations(),
    }) as unknown as Record<string, unknown>;
    value.markdown = "src/not-real.ts and fakeMethod()";
    expect(() => validateIndexerStructuredDeclarationSet({
      value,
      source_identity_inventory: inventory,
      expected_source_ref: SOURCE_REF,
      expected_module_ref: MODULE_REF,
      carrier_authority: {
        "indexer-result": [RESULT_REF],
        catalog: [CATALOG_REF, STORE_CATALOG_REF],
        manifest: [MANIFEST_REF],
        "section-evidence": [SECTION_REF],
      },
      known_evidence_refs: [EVIDENCE_REF],
    })).toThrow();
  });
});
