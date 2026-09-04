import { describe, expect, test } from "bun:test";
import {
  composeIndexerLayerInput,
  indexerLayerFragmentDigest,
  validateAndMaterializeIndexerLayerFragment,
  validateIndexerLayerCompositionInput,
  type IndexerLayerFragment,
  type IndexerMaterializedLayerFragment,
} from "../index.js";

const WORKSET_DIGEST = `sha256:${"1".repeat(64)}`;
const LAYER_INTEGRITY = `sha256:${"2".repeat(64)}`;
const VALIDATOR_DIGEST = `sha256:${"3".repeat(64)}`;
const LAYER_REF = "provider:sample#layer:extension";
const TARGET_REF = "member:src/example.ts";

function factFragment(overrides: Partial<IndexerLayerFragment> = {}): IndexerLayerFragment {
  const payload: Omit<IndexerLayerFragment, "fragment_digest"> = {
    protocol: "context.indexer.layer-fragment/v1",
    workset_digest: WORKSET_DIGEST,
    layer_ref: LAYER_REF,
    layer_integrity: LAYER_INTEGRITY,
    phase: "pre-authority",
    kind: "fact-enrichment",
    target_refs: [TARGET_REF],
    payload: {
      protocol: "context.indexer.fragment.fact-enrichment/v1",
      facts: [{
        target_ref: TARGET_REF,
        fact_id: "public-surface",
        value: { exported: true },
        evidence_refs: [{
          ref: "evidence:source-span-a",
          kind: "code",
          source_digest: `sha256:${"4".repeat(64)}`,
        }],
      }],
    },
    ...overrides,
  } as Omit<IndexerLayerFragment, "fragment_digest">;
  return {
    ...payload,
    fragment_digest: indexerLayerFragmentDigest(payload),
  };
}

function materialize(fragment = factFragment()): IndexerMaterializedLayerFragment {
  return validateAndMaterializeIndexerLayerFragment({
    fragment,
    expected_workset_digest: WORKSET_DIGEST,
    expected_layer_ref: LAYER_REF,
    expected_layer_integrity: LAYER_INTEGRITY,
    allowed_kinds: ["fact-enrichment", "template-variables"],
    allowed_target_refs: [TARGET_REF],
    validator_contract_digest: VALIDATOR_DIGEST,
  });
}

describe("Indexer layer fragment materialization", () => {
  test("materializes canonical payload and binds the validation receipt", () => {
    const fragment = factFragment();
    const materialized = materialize(fragment);
    expect(materialized.payload).toEqual(fragment.payload);
    expect(materialized.materialization_receipt).toMatchObject({
      fragment_digest: fragment.fragment_digest,
      payload_digest: materialized.payload_digest,
      layer_ref: LAYER_REF,
      layer_integrity: LAYER_INTEGRITY,
      validator_contract_digest: VALIDATOR_DIGEST,
    });
  });

  test("rejects digest drift, layer spoofing, and targets outside the workset", () => {
    const drift = factFragment();
    drift.fragment_digest = `sha256:${"5".repeat(64)}`;
    expect(() => materialize(drift)).toThrow(/digest/);

    expect(() => validateAndMaterializeIndexerLayerFragment({
      fragment: factFragment(),
      expected_workset_digest: WORKSET_DIGEST,
      expected_layer_ref: "provider:other#layer:extension",
      expected_layer_integrity: LAYER_INTEGRITY,
      allowed_kinds: ["fact-enrichment"],
      allowed_target_refs: [TARGET_REF],
      validator_contract_digest: VALIDATOR_DIGEST,
    })).toThrow(/authority binding/);

    const unknownTarget = factFragment({
      target_refs: ["member:src/other.ts"],
      payload: {
        protocol: "context.indexer.fragment.fact-enrichment/v1",
        facts: [{
          target_ref: "member:src/other.ts",
          fact_id: "public-surface",
          value: true,
          evidence_refs: [],
        }],
      },
    });
    expect(() => materialize(unknownTarget)).toThrow(/outside the current workset/);
  });

  test("enforces the phase/kind/payload union and fixed CLI output limits", () => {
    const wrongPhase = factFragment({ phase: "post-author" });
    expect(() => materialize(wrongPhase)).toThrow(/only valid in pre-authority/);

    expect(() => validateAndMaterializeIndexerLayerFragment({
      fragment: factFragment(),
      expected_workset_digest: WORKSET_DIGEST,
      expected_layer_ref: LAYER_REF,
      expected_layer_integrity: LAYER_INTEGRITY,
      allowed_kinds: ["fact-enrichment"],
      allowed_target_refs: [TARGET_REF],
      validator_contract_digest: VALIDATOR_DIGEST,
      limits: { maximum_items: 0, maximum_payload_bytes: 1_024 },
    })).toThrow(/item limit/);
  });
});

describe("LayerCompositionInputView", () => {
  test("carries sorted consumable payloads and a reproducible view digest", () => {
    const view = composeIndexerLayerInput({
      workset_digest: WORKSET_DIGEST,
      final_authority_layer_ref: "provider:sample#layer:primary",
      fragments: [materialize()],
    });
    expect(view.accepted_fragments[0]?.payload).toMatchObject({
      protocol: "context.indexer.fragment.fact-enrichment/v1",
    });
    expect(validateIndexerLayerCompositionInput(view)).toEqual(view);
  });

  test("rejects conflicting identities and tampered payload receipts", () => {
    const first = materialize();
    const secondFragment = factFragment({ layer_ref: "provider:other#layer:extension" });
    const second = validateAndMaterializeIndexerLayerFragment({
      fragment: secondFragment,
      expected_workset_digest: WORKSET_DIGEST,
      expected_layer_ref: secondFragment.layer_ref,
      expected_layer_integrity: LAYER_INTEGRITY,
      allowed_kinds: ["fact-enrichment"],
      allowed_target_refs: [TARGET_REF],
      validator_contract_digest: VALIDATOR_DIGEST,
    });
    expect(() => composeIndexerLayerInput({
      workset_digest: WORKSET_DIGEST,
      final_authority_layer_ref: "provider:sample#layer:primary",
      fragments: [first, second],
    })).toThrow(/conflict/);

    first.payload_digest = `sha256:${"6".repeat(64)}`;
    expect(() => composeIndexerLayerInput({
      workset_digest: WORKSET_DIGEST,
      final_authority_layer_ref: "provider:sample#layer:primary",
      fragments: [first],
    })).toThrow(/receipt/);
  });

  test("does not accept post-author proposals as primary input", () => {
    const postFragmentPayload: Omit<IndexerLayerFragment, "fragment_digest"> = {
      protocol: "context.indexer.layer-fragment/v1",
      workset_digest: WORKSET_DIGEST,
      layer_ref: LAYER_REF,
      layer_integrity: LAYER_INTEGRITY,
      composer_ref: `${LAYER_REF}#composer:derived-docs`,
      phase: "post-author",
      kind: "derived-artifact-proposal",
      target_refs: ["node:sample"],
      payload: {
        protocol: "context.indexer.fragment.derived-artifact-proposal/v1",
        proposals: [{
          composer_ref: `${LAYER_REF}#composer:derived-docs`,
          target_node_ref: "node:sample",
          artifact: {
            artifact_id: "overview",
            artifact_kind: "reference",
            artifact_policy_variant: "standard",
            representation: "sections",
            sections: [{
              section_key: "summary",
              owner_indexer_id: "sample-indexer",
              document_kind: "reference",
              reader_goal: "understand-capability",
              artifact_kind: "reference",
              blocks: [{
                block_id: "summary",
                layer: "semantic-prose",
                markdown: "Derived summary.",
                evidence_refs: ["evidence:sample"],
              }],
            }],
          },
          evidence_refs: [{
            ref: "evidence:sample",
            kind: "code",
            source_digest: `sha256:${"e".repeat(64)}`,
          }],
        }],
      },
    };
    const fragment: IndexerLayerFragment = {
      ...postFragmentPayload,
      fragment_digest: indexerLayerFragmentDigest(postFragmentPayload),
    };
    const materialized = validateAndMaterializeIndexerLayerFragment({
      fragment,
      expected_workset_digest: WORKSET_DIGEST,
      expected_layer_ref: LAYER_REF,
      expected_layer_integrity: LAYER_INTEGRITY,
      expected_composer_ref: `${LAYER_REF}#composer:derived-docs`,
      allowed_kinds: ["derived-artifact-proposal"],
      allowed_target_refs: ["node:sample"],
      validator_contract_digest: VALIDATOR_DIGEST,
    });
    expect(() => composeIndexerLayerInput({
      workset_digest: WORKSET_DIGEST,
      final_authority_layer_ref: "provider:sample#layer:primary",
      fragments: [materialized],
    })).toThrow(/pre-authority/);
  });
});
