import { describe, expect, test } from "bun:test";
import {
  buildIndexerArtifactDependencySet, buildIndexerRunEnvelope,
  indexerProtocolDigest, validateIndexerArtifactDependencySet,
} from "../index.js";
import {
  artifactResult, authorDependencyView, authorWorkset, digest, INPUT_DIGEST,
  PROVIDER, rehashArtifactResult, runEnvironment, validateArtifactResultFixture,
} from "./indexerArtifactResultV070.fixture.js";

function fixture() {
  const workset = authorWorkset();
  const result = structuredClone(artifactResult(workset));
  const artifact = result.artifacts[0]!;
  if (artifact.representation !== "sections") throw new Error("expected sections");
  artifact.sections[0]!.blocks = [{ block_id: "summary", layer: "deterministic-block",
    renderer: "json-code-block", fact_refs: [result.facts[0]!.fact_ref] }];
  rehashArtifactResult(result);
  return { result, workset, dependency_view: authorDependencyView(),
    run_envelope: buildIndexerRunEnvelope({ workset, execution_request_digest: INPUT_DIGEST,
      final_authority: PROVIDER, run_environment: runEnvironment(workset) }) };
}

describe("Author continues with current material instead of stale metadata gates", () => {
  test("records current fact content without comparing the old parser payload digest", () => {
    const input = fixture();
    const original = buildIndexerArtifactDependencySet(input);
    input.result.facts[0]!.value = {
      summary: "public button", locator: { path: "src/button.ts", start_line: 1, end_line: 20 },
      parser_annotation: "new source presentation",
    };
    rehashArtifactResult(input.result);
    expect(validateArtifactResultFixture(input.result)).toEqual(input.result);
    const updated = buildIndexerArtifactDependencySet(input);
    expect(validateIndexerArtifactDependencySet({ ...input, value: updated })).toEqual(updated);
    const fact = updated.positive_dependencies.find((node) => node.kind === "selected-fact")!;
    expect(fact).toMatchObject({ fact_digest: indexerProtocolDigest(input.result.facts[0]!) });
    expect(fact.node_ref).toBe(original.positive_dependencies.find((node) => node.kind === "selected-fact")!.node_ref);
    // The page/section identity is unchanged; new dependency content is retained
    // for the next update rather than silently claiming the old digest was used.
    expect(updated.artifacts[0]!.artifact_id).toBe(original.artifacts[0]!.artifact_id);
    expect(updated.artifacts[0]!.sections[0]!.section_key).toBe("summary");
    expect(updated.dependency_set_digest).not.toBe(original.dependency_set_digest);
  });

  test("accepts an expanded range in the same unchanged file and binds facts to that range", () => {
    const input = fixture();
    input.result.evidence_bindings[0]!.locator.end_line = 30;
    const updated = buildIndexerArtifactDependencySet(input);
    const span = updated.positive_dependencies.find((node) => node.kind === "source-span")!;
    const fact = updated.positive_dependencies.find((node) => node.kind === "selected-fact")!;
    expect(span).toMatchObject({ locator: { path: "src/button.ts", end_line: 30 } });
    expect(fact).toMatchObject({ source_span_node_refs: [span.node_ref] });
    expect(validateIndexerArtifactDependencySet({ ...input, value: updated })).toEqual(updated);
  });

  test("Provider bookkeeping changes do not invalidate a result from the same task and owner", () => {
    const input = fixture();
    Object.assign(input.result, { provider_integrity: digest("1"), provider_bundle_digest: digest("2"),
      config_fingerprint: digest("3"), customization_fingerprint: digest("4") });
    rehashArtifactResult(input.result);
    expect(validateArtifactResultFixture(input.result)).toEqual(input.result);
    expect(() => buildIndexerArtifactDependencySet(input)).not.toThrow();
    input.result.provider_layer_ref = "provider:other#layer:primary";
    rehashArtifactResult(input.result);
    expect(() => validateArtifactResultFixture(input.result)).toThrow("authority/workset");
    expect(() => buildIndexerArtifactDependencySet(input)).toThrow("same current author run");
  });

  test("unknown facts, source reassignment and genuinely changed file content still fail clearly", () => {
    const missing = fixture();
    missing.result.facts[0]!.fact_ref = "fact:unknown";
    expect(() => buildIndexerArtifactDependencySet(missing)).toThrow("not available in the current task");
    const detached = fixture();
    detached.result.facts[0]!.evidence_refs = [];
    expect(() => buildIndexerArtifactDependencySet(detached)).toThrow("different source");
    for (const change of [
      { source_ref: "repo:other" }, { module_ref: "module:other" },
      { content_digest: digest("0") }, { locator: { path: "src/other.ts", start_line: 1, end_line: 20 } },
    ]) {
      const input = fixture();
      Object.assign(input.result.evidence_bindings[0]!, change);
      expect(() => buildIndexerArtifactDependencySet(input)).toThrow("refresh the current task's source material");
    }
  });
});
