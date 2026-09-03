import { describe, expect, test } from "bun:test";
import {
  buildIndexerParserFactView,
  buildIndexerPartitionInventoryFromParserFactView,
  indexerEvidenceAdapterFactRef,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterOutputDigest,
  indexerProtocolDigest,
  type IndexerEvidenceAdapterResult,
  type IndexerInventoryMember,
} from "../index.js";

const sourceRef = "repo:20260903/example";
const analyzedPath = "src/index.ts";
const unsupportedPath = "conf/runtime.json";

function fileRef(path: string): string {
  return indexerEvidenceAdapterFileRef({
    source_ref: sourceRef,
    module_ref: null,
    normalized_path: path,
  });
}

describe("Indexer Partition inventory", () => {
  test("keeps unsupported files as blockers and omits parser-excluded files", () => {
    const locator = {
      source_ref: sourceRef,
      module_ref: null,
      normalized_path: analyzedPath,
      qualified_item_path: "Example",
      signature_digest: indexerProtocolDigest({ signature: "Example" }),
    };
    const factRef = indexerEvidenceAdapterFactRef({ ...locator, kind: "component" });
    const resultBase: Omit<IndexerEvidenceAdapterResult, "output_digest"> = {
      protocol: "context.indexer.evidence-adapter-result/v1",
      adapter: {
        id: "fixture-parser",
        package: "@fixture/parser",
        export: "parse",
        version: "1.0.0",
        digest: indexerProtocolDigest({ package: "@fixture/parser" }),
      },
      authorized_scope: {
        source_ref: sourceRef,
        module_refs: [],
        scope_digest: indexerProtocolDigest({
          source_ref: sourceRef,
          module_refs: [],
        }),
      },
      input_digest: indexerProtocolDigest({ input: "fixture" }),
      precedence: 10,
      files: ([{
        file_ref: fileRef(analyzedPath),
        source_ref: sourceRef,
        module_ref: null,
        normalized_path: analyzedPath,
        role: "primary-owner",
        coverage_tier: "lightweight-evidence",
        disposition: "analyzed",
        facts: [{
          fact_ref: factRef,
          kind: "component",
          locator,
          payload_digest: indexerProtocolDigest({ name: "Example" }),
          denominator: "none",
        }],
      }, {
        file_ref: fileRef(unsupportedPath),
        source_ref: sourceRef,
        module_ref: null,
        normalized_path: unsupportedPath,
        role: "primary-owner",
        coverage_tier: "lightweight-evidence",
        disposition: "unsupported",
        facts: [],
      }, {
        file_ref: fileRef("vendor/generated.ts"),
        source_ref: sourceRef,
        module_ref: null,
        normalized_path: "vendor/generated.ts",
        role: "primary-owner",
        coverage_tier: "lightweight-evidence",
        disposition: "excluded",
        facts: [],
      }] satisfies IndexerEvidenceAdapterResult["files"]).sort((left, right) =>
        left.file_ref.localeCompare(right.file_ref)
      ),
      diagnostics: [],
      toolchain: [{
        step: "parse",
        package: "@fixture/parser",
        export: "parse",
        version: "1.0.0",
        digest: indexerProtocolDigest({ package: "@fixture/parser" }),
        capabilities: ["parser.typescript"],
        input_digest: indexerProtocolDigest({ input: "fixture" }),
        output_digest: indexerProtocolDigest({ output: "fixture" }),
      }],
    };
    const result: IndexerEvidenceAdapterResult = {
      ...resultBase,
      output_digest: indexerEvidenceAdapterOutputDigest(resultBase),
    };
    const view = buildIndexerParserFactView({
      adapter_results: [result],
      fact_payloads: [{ fact_ref: factRef, payload: { name: "Example" } }],
      inventory_digest: indexerProtocolDigest({ inventory: "fixture" }),
    });

    const expected: IndexerInventoryMember[] = [
      { member_id: fileRef(analyzedPath), member_kind: "entry" },
      { member_id: fileRef(unsupportedPath), member_kind: "entry" },
      { member_id: factRef, member_kind: "component" },
    ];
    expect(buildIndexerPartitionInventoryFromParserFactView(view)).toEqual(
      expected.sort((left, right) => left.member_id.localeCompare(right.member_id)),
    );
  });
});
