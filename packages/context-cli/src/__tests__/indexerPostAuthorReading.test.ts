import { expect, test } from "bun:test";
import { materializeIndexerPrimaryResultView, type IndexerComposerDeclaration } from "@c4a/context";
import { renderIndexerPostAuthorReading } from "../project/indexerPostAuthorReading.js";
import { missingComposerInputs } from "../project/indexerComposerApplicability.js";

const digest = `sha256:${"a".repeat(64)}`;
const reference = { source_ref: "repo:sample", locator: { path: "src/panel.ts", start_line: 1, end_line: 3 }, content_digest: digest };
function view() {
  return materializeIndexerPrimaryResultView({ workset_digest: digest, primary_result_digest: digest, validator_contract_digest: digest,
    artifacts: [{ artifact_ref: "article:canonical", artifact_kind: "content", artifact_policy_variant: "standard",
      variables: { representation: "sections", sections: [{ section_key: "usage", document_kind: "guide", blocks: [
        { layer: "semantic-prose", block_id: "body", markdown: "# Panel\n\nRead the panel.", references: [reference] },
      ] }] } }],
  });
}

test("Composer reading preserves Markdown and direct source regions without restoring a fact ledger", () => {
  const input = view(); const before = JSON.stringify(input);
  const reading = renderIndexerPostAuthorReading(input);
  expect(reading).toContain("# Panel\n\nRead the panel.");
  expect(reading).toContain("artifact:1");
  expect(reading).toContain('"source_ref": "repo:sample"');
  expect(reading).toContain('"path": "src/panel.ts"');
  expect(reading).toContain('"start_line": 1');
  expect(reading).toContain(digest);
  expect(reading).not.toContain("materialization_receipt");
  expect(reading).not.toContain("primary_result_digest");
  expect(reading).not.toContain('"facts"');
  expect(reading).not.toContain('"subject_key"');
  expect(JSON.stringify(input)).toBe(before);
  expect(() => renderIndexerPostAuthorReading({ ...input, artifacts: [] })).toThrow();
});

test("Composer applicability uses the declared article kinds, not retired fact kinds", () => {
  const composer = { contract: { primary_requirements: { artifact_kinds: ["content"] } } } as IndexerComposerDeclaration;
  expect(missingComposerInputs(composer, view())).toEqual([]);
  expect(missingComposerInputs(composer, { ...view(), artifacts: [] })).toEqual(["artifact:content"]);
});

test("Composer shares repeated section metadata but keeps provider values and every section", () => {
  const original = view();
  const members = Array.from({ length: 10 }, (_, i) => ({ name: `value${i}`, optional: true, default: i % 2 === 0 }));
  const sections = ["usage", "limits"].map(section_key => ({ section_key, owner: "sample-provider", custom: { keep: true },
    blocks: [{ layer: "semantic-prose", markdown: `## ${section_key}\nRead this section.`, references: [reference] }],
  }));
  const input = materializeIndexerPrimaryResultView({ workset_digest: digest, primary_result_digest: digest, validator_contract_digest: digest,
    artifacts: original.artifacts.map(artifact => ({ ...artifact, variables: { representation: "sections", sections, members } })),
  });
  const before = JSON.stringify(input);
  const reading = renderIndexerPostAuthorReading(input);
  const blocks = [...reading.matchAll(/```json\n([\s\S]*?)\n```/gu)].map(match => JSON.parse(match[1]!));
  expect(blocks.filter(block => block.owner === "sample-provider")).toHaveLength(1);
  expect(blocks.some(block => block.section_key === "usage")).toBe(true);
  expect(blocks.some(block => block.section_key === "limits")).toBe(true);
  expect(blocks.find(block => Array.isArray(block.members))?.members).toEqual(members);
  expect(reading).toContain("## limits\nRead this section.");
  expect(JSON.stringify(input)).toBe(before);
});
