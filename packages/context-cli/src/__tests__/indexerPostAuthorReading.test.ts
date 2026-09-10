import { expect, test } from "bun:test";
import { materializeIndexerPrimaryResultView, type IndexerComposerDeclaration } from "@c4a/context";
import { renderIndexerPostAuthorReading } from "../project/indexerPostAuthorReading.js";
import { missingComposerInputs } from "../project/indexerComposerApplicability.js";

const digest = `sha256:${"a".repeat(64)}`;
const subject = { protocol: "context.subject-key/v1" as const, namespace: "sample", kind: "component", local_key: "panel" };
const evidence = [{ kind: "code" as const, ref: "evidence:sample", source_digest: digest }];
function view() {
  return materializeIndexerPrimaryResultView({ workset_digest: digest, primary_result_digest: digest, validator_contract_digest: digest,
    facts: [{ fact_ref: "fact:canonical", subject_key: subject, fact_kind: "code-symbol", evidence_refs: evidence,
      value: { name: "Panel", typeAnnotation: "/** @default false */ enabled?: boolean", contractResolution: "declaration-only",
        evidence_refs: ["business-value-must-survive"], members: [{ name: "enabled", optional: true, type: "boolean" }] } }],
    artifacts: [{ artifact_ref: "artifact:canonical", subject_key: subject, artifact_kind: "content", artifact_policy_variant: "standard", evidence_refs: evidence,
      variables: { representation: "sections", sections: [{ section_key: "usage", document_kind: "guide", blocks: [
        { layer: "semantic-prose", block_id: "body", markdown: "# Panel\n\nRead the panel.", evidence_refs: ["evidence:sample"] },
        { layer: "deterministic-block", block_id: "api", renderer: "public-contract-table", fact_refs: ["fact:canonical"] },
      ] }] } }],
  });
}

test("Composer reading preserves semantic values and Markdown while using submission aliases", () => {
  const input = view(); const before = JSON.stringify(input);
  const reading = renderIndexerPostAuthorReading(input);
  expect(reading).toContain("# Panel\n\nRead the panel.");
  expect(reading).toContain('"fact:1"');
  expect(reading).toContain("artifact:1");
  expect(reading.indexOf("# Panel\n")).toBeLessThan(reading.indexOf("### fact:1"));
  expect(reading).toContain("@default false");
  expect(reading).toContain("declaration-only");
  expect(reading).toContain("business-value-must-survive");
  expect(reading).not.toContain("evidence:sample");
  expect(reading).not.toContain("materialization_receipt");
  expect(reading).not.toContain(digest);
  expect(JSON.stringify(input)).toBe(before);
  expect(() => renderIndexerPostAuthorReading({ ...input, facts: [] })).toThrow();
});

test("Composer applicability follows declared kinds and actual evidenced inputs", () => {
  const composer = { contract: { primary_requirements: { fact_kinds: ["code-symbol"], artifact_kinds: ["content"] } } } as IndexerComposerDeclaration;
  expect(missingComposerInputs(composer, view())).toEqual([]);
  expect(missingComposerInputs(composer, { ...view(), facts: [] })).toEqual(["fact:code-symbol"]);
  expect(missingComposerInputs(composer, { ...view(), artifacts: [] })).toEqual(["artifact:content"]);
  const unbound = view(); unbound.facts[0]!.evidence_refs = [];
  expect(missingComposerInputs(composer, unbound)).toEqual(["fact:code-symbol"]);
});

test("Composer shares section metadata and preserves member values without changing canonical facts", () => {
  const original = view();
  const sections = ["usage", "limits"].map(section_key => ({ section_key, owner: "sample-provider", custom: { keep: true },
    blocks: [{ layer: "semantic-prose", markdown: `## ${section_key}\nRead this section.` }],
  }));
  const members = Array.from({ length: 10 }, (_, i) => ({ name: `value${i}`, kind: "property", optional: true,
    visibility: "exported", file: "src/options.ts", type: "boolean", default: i % 2 === 0 }));
  const input = materializeIndexerPrimaryResultView({ workset_digest: digest, primary_result_digest: digest, validator_contract_digest: digest,
    facts: original.facts.map(fact => ({ ...fact, value: { ...fact.value as object, members } })),
    artifacts: original.artifacts.map(artifact => ({ ...artifact, variables: { representation: "sections", sections } })),
  });
  const before = JSON.stringify(input);
  const reading = renderIndexerPostAuthorReading(input);
  const blocks = [...reading.matchAll(/```json\n([\s\S]*?)\n```/gu)].map(match => JSON.parse(match[1]!));
  expect(blocks.filter(block => block.owner === "sample-provider")).toHaveLength(1);
  expect(blocks.some(block => block.section_key === "usage")).toBe(true);
  expect(blocks.some(block => block.section_key === "limits")).toBe(true);
  const groups = blocks.find(block => block.kind === "code-symbol").value.members.groups;
  expect(groups.flatMap((group: { common: object; columns: string[]; rows: unknown[][] }) => group.rows.map(row => ({ ...group.common,
    ...Object.fromEntries(group.columns.map((key, i) => [key, row[i]])),
  })))).toEqual(members);
  expect(reading).toContain("## limits\nRead this section.");
  expect(JSON.stringify(input)).toBe(before);
});
