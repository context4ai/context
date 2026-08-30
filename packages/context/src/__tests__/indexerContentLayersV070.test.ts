import { describe, expect, test } from "bun:test";
import {
  buildIndexerRenderedContentBlock,
  materializeIndexerStructuredContent,
  projectIndexerFactValue,
  renderIndexerDeterministicFacts,
  validateIndexerRenderedContentBlock,
  type IndexerArtifactFact,
  type IndexerSubjectKey,
} from "../index.js";

const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "anonymous-package",
  kind: "component",
  local_key: "button",
};

function fact(ref: string, value: string): IndexerArtifactFact {
  return {
    fact_ref: ref,
    fact_kind: "public-example",
    subject_key: SUBJECT,
    value,
    evidence_refs: [`evidence:${ref.slice("fact:".length)}`],
  };
}

describe("Indexer Fact/content layer protocol", () => {
  test("projects canonical Facts through deterministic blocks without counting them as prose", () => {
    const facts = [fact("fact:example-b", "Second"), fact("fact:example-a", "First")];
    expect(projectIndexerFactValue(facts)).toEqual(["First", "Second"]);
    expect(renderIndexerDeterministicFacts({ renderer: "bullet-list", facts })).toBe(
      "- First\n- Second",
    );

    const blocks = materializeIndexerStructuredContent({
      facts,
      blocks: [{
        block_id: "example-catalog",
        layer: "deterministic-block",
        renderer: "bullet-list",
        fact_refs: ["fact:example-b", "fact:example-a"],
      }, {
        block_id: "usage-boundary",
        layer: "semantic-prose",
        markdown: "Use the examples only through the public component contract.",
        evidence_refs: ["evidence:example-a"],
      }],
    });
    expect(blocks.map((block) => block.layer)).toEqual([
      "deterministic-block",
      "semantic-prose",
    ]);
    expect(blocks[0]?.fact_refs).toEqual(["fact:example-a", "fact:example-b"]);
    expect(blocks[0]?.evidence_refs).toEqual([
      "evidence:example-a",
      "evidence:example-b",
    ]);
    expect(blocks[1]?.fact_refs).toEqual([]);
    expect(blocks.map(validateIndexerRenderedContentBlock)).toEqual(blocks);
  });

  test("rejects layer spoofing and digest drift", () => {
    expect(() => buildIndexerRenderedContentBlock({
      layer: "deterministic-block",
      markdown: "Invented catalog",
      evidence_refs: ["evidence:sample"],
    })).toThrow("does not match");
    expect(() => buildIndexerRenderedContentBlock({
      layer: "semantic-prose",
      markdown: "Narrative",
      fact_refs: ["fact:sample"],
      evidence_refs: ["evidence:sample"],
    })).toThrow("does not match");

    const block = buildIndexerRenderedContentBlock({
      layer: "semantic-prose",
      markdown: "Source-backed explanation.",
      evidence_refs: ["evidence:sample"],
    });
    expect(() => validateIndexerRenderedContentBlock({
      ...block,
      markdown: "Changed explanation.",
    })).toThrow("digest");
  });
});
