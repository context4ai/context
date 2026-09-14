import { describe, expect, test } from "bun:test";
import { buildIndexerInventoryDispositionSet } from "../index.js";
import {
  MEMBER_REF, QUESTION_TARGET, artifactResult, authorWorkset, digest,
  rehashArtifactResult as rehash, validateArtifactResultFixture as validate,
} from "./indexerArtifactResultV070.fixture.js";

function section(result = artifactResult()) {
  const artifact = result.artifacts[0]!;
  if (artifact.representation !== "sections") throw new Error("Expected sections");
  return artifact.sections[0]!;
}

describe("Article result contract", () => {
  test("request-material requires an active question gap, not merely an existing proposal", () => {
    const result = artifactResult();
    result.inventory_dispositions = buildIndexerInventoryDispositionSet({
      author_workset_digest: result.author_workset_digest,
      group_projection_digest: result.group_projection_digest,
      logical_unit_ref: result.logical_unit.logical_unit_ref,
      dispositions: [{ member_id: MEMBER_REF, member_kind: "component",
        inventory_disposition: "request-material", material_question_proposal_ref: "proposal:public-contract-gap" }],
    });
    rehash(result);
    expect(() => validate(result)).not.toThrow();
    result.question_target_dispositions = [{ question_target_key: QUESTION_TARGET, state: "answered" }];
    rehash(result);
    expect(() => validate(result)).toThrow("blocking material gap");
    result.question_target_dispositions = [];
    rehash(result);
    expect(() => validate(result)).toThrow("blocking material gap");
  });
  test("accepts reader content and direct region references without a fact ledger", () => {
    const result = artifactResult();
    expect(validate(result)).toEqual(result);
    expect(result).not.toHaveProperty("facts");
    expect(result).not.toHaveProperty("evidence_bindings");
    expect(result.logical_unit).not.toHaveProperty("subject_key");
  });

  test.each(["output_path", "collection", "facts", "evidence_bindings", "structured_claims"])(
    "does not reintroduce retired or host-owned field %s", field => {
      expect(() => validate({ ...artifactResult(), [field]: [] })).toThrow();
    },
  );

  test.each([
    "style={{ opacity }} is JSX syntax.", "<!-- source annotation -->",
    "## Summary", "TODO", "[TODO]", "{{variable:summary}}", "Coming soon",
    "The implementation may retry; this is a proposal, not confirmed behavior.",
  ])("leaves prose quality to Review: %s", markdown => {
    const result = artifactResult();
    section(result).blocks[0]!.markdown = markdown;
    rehash(result);
    expect(validate(result)).toEqual(result);
    const references = section(result).blocks[0]!.references;
    result.artifacts = [{
      artifact_id: "button-overview", artifact_kind: "overview",
      artifact_policy_variant: "standard", representation: "template",
      template_id: "component-guide",
      variables: { summary: { value: markdown, references } },
      section_projections: [{
        section_key: "summary", owner_indexer_id: result.indexer_id,
        document_kind: "reference", reader_goal: "understand-capability", artifact_kind: "overview",
      }],
    }];
    rehash(result);
    expect(validate(result)).toEqual(result);
  });

  test("limits references per output fragment, not per article", () => {
    const result = artifactResult();
    const current = section(result);
    const reference = current.blocks[0]!.references[0]!;
    current.blocks = Array.from({ length: 4 }, (_, index) => ({
      block_id: `paragraph-${index}`, layer: "semantic-prose" as const,
      markdown: `Explanation ${index}`,
      references: Array.from({ length: 3 }, (_, offset) => ({
        ...reference, locator: { path: "src/button.ts", start_line: offset + 1, end_line: offset + 1 },
      })),
    }));
    rehash(result);
    expect(validate(result)).toEqual(result);
    current.blocks[0]!.references.push({
      ...reference, locator: { path: "src/button.ts", start_line: 4, end_line: 4 },
    });
    rehash(result);
    expect(() => validate(result)).toThrow();
  });

  test.each(["provider_layer_ref", "provider_integrity", "provider_bundle_digest",
    "config_fingerprint", "customization_fingerprint", "source_ref", "module_ref"] as const)(
    "rejects stale authority in %s even with a recomputed result digest", field => {
      const result = artifactResult();
      result[field] = field.endsWith("_ref") ? "provider:other#layer:primary" : digest("f");
      rehash(result);
      expect(() => validate(result)).toThrow(/authority\/workset/);
    },
  );

  test("rejects output corruption", () => {
    const result = artifactResult();
    result.output_digest = digest("f");
    expect(() => validate(result)).toThrow(/output digest/);
  });

  test("requires explicit authorization for another source", () => {
    const result = artifactResult();
    section(result).blocks[0]!.references[0]!.source_ref = "file:registered-guide";
    rehash(result);
    expect(() => validate(result)).toThrow(/authorized sources/);
    expect(validate(result, authorWorkset(), {
      authorized_evidence_targets: [{ source_ref: "file:registered-guide", module_refs: [] }],
    })).toEqual(result);
    expect(() => validate(result, authorWorkset(), {
      authorized_evidence_targets: [{ source_ref: "file:another-guide", module_refs: [] }],
    })).toThrow(/authorized sources/);
  });

  test("rejects invalid paths and inverted source regions", () => {
    for (const locator of [
      { path: "../secret", start_line: 1, end_line: 2 },
      { path: "src/button.ts", start_line: 3, end_line: 2 },
    ]) {
      const result = artifactResult();
      section(result).blocks[0]!.references[0]!.locator = locator;
      rehash(result);
      expect(() => validate(result)).toThrow();
    }
  });

  test("keeps policy and section ownership validation", () => {
    const policy = artifactResult();
    policy.artifacts[0]!.artifact_policy_variant = "unregistered";
    rehash(policy);
    expect(() => validate(policy)).toThrow(/ineligible policy/);
    const ownership = artifactResult();
    section(ownership).owner_indexer_id = "another-indexer";
    rehash(ownership);
    expect(() => validate(ownership)).toThrow(/owner\/kind/);
  });

  test("does not accept inventory coverage pointing to a missing fragment", () => {
    const result = artifactResult();
    result.inventory_dispositions = buildIndexerInventoryDispositionSet({
      author_workset_digest: result.author_workset_digest,
      group_projection_digest: result.group_projection_digest,
      logical_unit_ref: result.logical_unit.logical_unit_ref,
      dispositions: [{
        member_id: MEMBER_REF, member_kind: "component",
        inventory_disposition: "owned", projection_disposition: "detailed",
        section_evidence: [{ artifact_id: "button-overview", section_key: "missing" }],
      }],
    });
    rehash(result);
    expect(() => validate(result)).toThrow();
  });

  test("rejects unknown question targets and mismatched material proposals", () => {
    const unknown = artifactResult();
    unknown.question_target_dispositions[0]!.question_target_key = "question-target:unknown";
    rehash(unknown);
    expect(() => validate(unknown)).toThrow(/Unknown question target/);
    const wrong = artifactResult();
    wrong.question_target_dispositions = [{
      question_target_key: QUESTION_TARGET, state: "material-gap",
      material_question_proposal_ref: "proposal:missing",
    }];
    rehash(wrong);
    expect(() => validate(wrong)).toThrow(/another question/);
  });
});
