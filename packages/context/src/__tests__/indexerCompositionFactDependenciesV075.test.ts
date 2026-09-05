import { describe, expect, test } from "bun:test";
import {
  buildIndexerArtifactDependencySet, buildIndexerRunEnvelope, composeIndexerLayerInput,
  indexerLayerFragmentDigest, validateAndMaterializeIndexerLayerFragment,
  validateIndexerArtifactDependencySet, buildIndexerMainRunRequest, validateIndexerMainRunResult,
} from "../index.js";
import {
  artifactResult, authorDependencyView, authorWorkset, digest, INPUT_DIGEST,
  PROVIDER, rehashArtifactResult, runEnvironment, ELIGIBILITY, SUBJECT, QUESTION_TARGET, QUESTION_REF,
} from "./indexerArtifactResultV070.fixture.js";

function fixture(options: { source?: string; target?: string; compositionWorkset?: string } = {}) {
  const workset = authorWorkset();
  const result = artifactResult(workset);
  const sourceFact = result.facts[0]!;
  const target = options.target ?? workset.logical_unit_ref;
  const base = {
    protocol: "context.indexer.layer-fragment/v1" as const,
    workset_digest: workset.workset_digest,
    layer_ref: "provider:framework#layer:extension", layer_integrity: digest("b"),
    phase: "pre-authority" as const, kind: "fact-enrichment" as const,
    target_refs: [target],
    payload: {
      protocol: "context.indexer.fragment.fact-enrichment/v1" as const,
      facts: [{ target_ref: target, fact_id: "framework-config",
        value: { framework: "sample", configuration_files: ["app.config.ts"] },
        evidence_refs: [{ ref: options.source ?? sourceFact.fact_ref,
          kind: "code" as const, source_digest: digest("c") }],
      }],
    },
  };
  const fragment = validateAndMaterializeIndexerLayerFragment({
    fragment: { ...base, fragment_digest: indexerLayerFragmentDigest(base) },
    expected_workset_digest: base.workset_digest,
    expected_layer_ref: base.layer_ref, expected_layer_integrity: base.layer_integrity,
    allowed_kinds: ["fact-enrichment"], allowed_target_refs: [target],
    validator_contract_digest: digest("d"),
  });
  const composition = composeIndexerLayerInput({
    workset_digest: options.compositionWorkset ?? workset.workset_digest,
    final_authority_layer_ref: PROVIDER.layer_ref, fragments: [fragment],
  });
  const ref = `layer-fact:${fragment.fragment_digest}/framework-config`;
  result.facts = [{ ...sourceFact, fact_ref: ref, fact_kind: "framework-config",
    value: base.payload.facts[0]!.value }];
  const artifact = result.artifacts[0]!;
  if (artifact.representation !== "sections") throw new Error("expected sections");
  artifact.sections[0]!.blocks = [{ block_id: "config", layer: "deterministic-block",
    renderer: "json-code-block", fact_refs: [ref] }];
  rehashArtifactResult(result);
  return { result, workset, composition_input: composition,
    dependency_view: authorDependencyView(),
    run_envelope: buildIndexerRunEnvelope({ workset, execution_request_digest: INPUT_DIGEST,
      final_authority: PROVIDER, run_environment: runEnvironment(workset) }) };
}

describe("accepted extension fact dependencies", () => {
  test("the main Author result validator forwards its accepted composition", () => {
    const input = fixture();
    const request = buildIndexerMainRunRequest({
      workset: input.workset, composition_input: input.composition_input,
      final_authority: PROVIDER, run_environment: runEnvironment(input.workset),
    });
    input.result.input_digest = request.execution_request_digest;
    rehashArtifactResult(input.result);
    const validated = validateIndexerMainRunResult({
      request,
      result: { protocol: "context.indexer.run-result/v1", operation: "main-index",
        consumed_input_view_digest: request.composition_input.view_digest,
        result: { protocol: "context.indexer.main-result/v1", stage: "author",
          workset_digest: input.workset.workset_digest,
          execution_request_digest: request.execution_request_digest, result: input.result } },
      validation: { stage: "author", dependency_view: input.dependency_view,
        expected_subject_key: SUBJECT, artifact_policy_eligibility: ELIGIBILITY,
        allowed_source_roles: ["authoritative-source"],
        allowed_question_targets: [{ question_target_key: QUESTION_TARGET, question_ref: QUESTION_REF }] },
    });
    expect(validated.artifact_dependency_set?.positive_dependencies.some(node =>
      node.kind === "selected-fact" && node.fact_ref === input.result.facts[0]!.fact_ref
    )).toBe(true);
  });

  test("retains the derived fact and its real source dependency without changing the base workset", () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = buildIndexerArtifactDependencySet(input);
    expect(validateIndexerArtifactDependencySet({ ...input, value: result })).toEqual(result);
    expect(result.positive_dependencies.filter(node => node.kind === "selected-fact")
      .map(node => node.fact_ref)).toEqual([input.result.facts[0]!.fact_ref]);
    expect(result.positive_dependencies.some(node => node.kind === "source-span")).toBe(true);
    expect(input).toEqual(before);
  });

  test("does not accept an extension fact without its accepted composition", () => {
    const { composition_input: _composition, ...input } = fixture();
    void _composition;
    expect(() => buildIndexerArtifactDependencySet(input)).toThrow("absent or stale");
  });

  test("rejects changed output values and evidence", () => {
    const changed = fixture();
    changed.result.facts[0]!.value = { framework: "invented" };
    rehashArtifactResult(changed.result);
    expect(() => buildIndexerArtifactDependencySet(changed)).toThrow("absent or stale");
    const missing = fixture();
    missing.result.facts[0]!.evidence_refs = [];
    rehashArtifactResult(missing.result);
    expect(() => buildIndexerArtifactDependencySet(missing)).toThrow("absent or stale");
  });

  test("rejects unknown backing facts, another subject and another workset", () => {
    expect(() => buildIndexerArtifactDependencySet(fixture({ source: "fact:missing" })))
      .toThrow("unavailable source fact");
    expect(() => buildIndexerArtifactDependencySet(fixture({ target: "node:another" })))
      .toThrow("another logical unit");
    expect(() => buildIndexerArtifactDependencySet(fixture({ compositionWorkset: digest("e") })))
      .toThrow("another author run");
  });
});
