import { describe, expect, test } from "bun:test";
import {
  indexerLayerFragmentDigest,
  validateAndMaterializeIndexerLayerFragment,
  type IndexerInspectorResult,
} from "@c4a/context";
import { buildCurrentIndexerExtensionFactPayload } from "../project/indexerCurrentInspector.js";

const digest = (value: string) => `sha256:${value.repeat(64)}`;
const target = "node:sample";
const sourceFacts = new Map([
  ["fact:a", { payload_digest: digest("a") }],
  ["fact:B", { payload_digest: digest("b") }],
]);

function projection(ref: string, profile: string): IndexerInspectorResult["fact_payloads"][number] {
  return {
    fact_ref: ref,
    payload: {
      profile, profile_variants: {}, source_fact_refs: ["fact:a", "fact:B"],
      template_variables: { configuration_files: ["app.config.ts"] }, status: "available",
    },
  };
}

function materialize(factPayloads: IndexerInspectorResult["fact_payloads"]) {
  const payload = buildCurrentIndexerExtensionFactPayload({
    target_ref: target, fact_payloads: factPayloads, source_facts: sourceFacts,
  });
  const base = {
    protocol: "context.indexer.layer-fragment/v1" as const,
    workset_digest: digest("a"), layer_ref: "provider:extension#layer:extension",
    layer_integrity: digest("b"), phase: "pre-authority" as const,
    kind: "fact-enrichment" as const, target_refs: [target], payload,
  };
  const fragment = { ...base, fragment_digest: indexerLayerFragmentDigest(base) };
  validateAndMaterializeIndexerLayerFragment({
    fragment, expected_workset_digest: base.workset_digest,
    expected_layer_ref: base.layer_ref, expected_layer_integrity: base.layer_integrity,
    allowed_kinds: ["fact-enrichment"], allowed_target_refs: [target],
    validator_contract_digest: digest("c"),
  });
  return fragment;
}

describe("extension inspector to Author fragment", () => {
  test("orders final identities even when profile names reverse inspector fact order", () => {
    const inputs = [projection("fact:1", "sample/zeta"), projection("fact:2", "sample/alpha")];
    const result = materialize(inputs);
    expect(result.payload.facts.map((item) => item.fact_id)).toEqual([
      "enrichment-sample/alpha-2", "enrichment-sample/zeta-1",
    ]);
    expect(JSON.stringify(result.payload.facts[0]?.value)).toBe(JSON.stringify(inputs[1]!.payload));
    expect(result.payload.facts[0]?.evidence_refs.map((item) => item.ref)).toEqual(["fact:B", "fact:a"]);
    expect(materialize([...inputs].reverse())).toEqual(result);
    expect(inputs[0]?.payload.source_fact_refs).toEqual(["fact:a", "fact:B"]);
  });

  test("uses canonical text order rather than numeric suffix order for larger fragments", () => {
    const inputs = Array.from({ length: 12 }, (_, i) => projection(`fact:${String(i).padStart(2, "0")}`, "sample/application"));
    const ids = materialize(inputs).payload.facts.map((item) => item.fact_id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toHaveLength(12);
  });

  test("does not conceal an unknown evidence reference", () => {
    const input = projection("fact:1", "sample/application");
    input.payload.source_fact_refs = ["fact:missing"];
    expect(() => materialize([input])).toThrow("unknown source fact fact:missing");
  });
});
