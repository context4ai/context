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

describe("Article content rendering", () => {
  test("renders parser tables on demand without making facts an article payload", () => {
    const facts = [fact("fact:example-b", "Second"), fact("fact:example-a", "First")];
    expect(projectIndexerFactValue(facts)).toEqual(["First", "Second"]);
    expect(renderIndexerDeterministicFacts({ renderer: "bullet-list", facts })).toBe("- First\n- Second");
  });

  test("materializes prose and its actual region references", () => {
    const references = [{ source_ref: "file:guide",
      locator: { path: "guide.md", start_line: 1, end_line: 3 },
      content_digest: `sha256:${"a".repeat(64)}` }];
    const blocks = materializeIndexerStructuredContent({ blocks: [{
      block_id: "usage", layer: "semantic-prose", markdown: "Use the public entry.", references,
    }] });
    expect(blocks[0]).toMatchObject({ layer: "semantic-prose", markdown: "Use the public entry.", references });
    expect(blocks[0]).not.toHaveProperty("fact_refs");
    expect(blocks[0]).not.toHaveProperty("evidence_refs");
    expect(blocks.map(validateIndexerRenderedContentBlock)).toEqual(blocks);
  });

  test("rejects rendered content digest drift", () => {
    const block = buildIndexerRenderedContentBlock({
      layer: "semantic-prose", markdown: "Source-backed explanation.", references: [],
    });
    expect(() => validateIndexerRenderedContentBlock({ ...block, markdown: "Changed." })).toThrow("digest");
  });
});

test("supporting defaults retain their evidence and cannot read unrelated subjects", () => {
  const props: IndexerArtifactFact = { ...fact("fact:props", ""), subject_key: SUBJECT, value: {
    name: "Props", kind: "type", file: "view.tsx", visibility: "exported", members: [
      { name: "enabled", kind: "prop", typeAnnotation: "boolean", defaultValue: "false" },
    ],
  } };
  const component: IndexerArtifactFact = { ...fact("fact:component", ""), subject_key: SUBJECT, value: {
    name: "View", kind: "component", file: "view.tsx", visibility: "exported", propsType: "Props",
    members: [{ name: "enabled", kind: "prop", typeAnnotation: "boolean", defaultValue: "true" }],
  } };
  const rendered = renderIndexerDeterministicFacts({
    renderer: "public-contract-table", facts: [props], supporting_facts: [component],
  });
  expect(rendered).toContain("| true |");
  expect(rendered).not.toContain("| View | enabled |");
  const unrelated = { ...component, subject_key: { ...SUBJECT, local_key: "other" } };
  const isolated = renderIndexerDeterministicFacts({
    renderer: "public-contract-table", facts: [props], supporting_facts: [unrelated],
  });
  expect(isolated).toContain("| false |");
});
