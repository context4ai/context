import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { indexerTemplateContractSchema, type ArticleSourceReference, type IndexerArtifactResult } from "@c4a/context";
import { applySelectedPageTemplate } from "../project/indexerPageTemplate.js";
import { splitFrontmatter, parseSectionBodies } from "../project/indexerTemplateRendering.js";

const reference: ArticleSourceReference = { source_ref: "repo:widgets", locator: {
  path: "panel.tsx", start_line: 2, end_line: 8 }, content_digest: "sha256:" + "a".repeat(64) };
async function fixture() {
  const source = await readFile(join(import.meta.dir,
    "../../../../plugins/context/skills/context-code-indexer/templates/component-library-usage-guide.md"), "utf8");
  const parsed = splitFrontmatter(source);
  const contract = indexerTemplateContractSchema.parse(parsed.metadata);
  const artifact: Extract<IndexerArtifactResult["artifacts"][number], { representation: "sections" }> = {
    artifact_id: "panel-guide", artifact_kind: "content", artifact_policy_variant: "standard", representation: "sections",
    sections: [{ section_key: "panel-guide--usage", owner_indexer_id: "widgets", document_kind: "usage-guide",
      reader_goal: "integrate-capability", artifact_kind: "content", blocks: [{ block_id: "usage",
        layer: "semantic-prose", markdown: "# Panel\n\nPass a label.", references: [reference] }] }],
  };
  return { artifact, template: { contract, section_bodies: parseSectionBodies(parsed.body) } };
}

test("page program formats supplied API Markdown and its region without copying parser facts", async () => {
  const input = await fixture();
  input.template.section_bodies.api = input.template.section_bodies.api!.replace("## API", "## Declared properties");
  const api = "| Property | Type |\n| --- | --- |\n| label | string |";
  applySelectedPageTemplate({ ...input, articleKey: "panel-guide",
    semanticVariables: { api: { value: api, references: [reference] } } });
  expect(input.artifact.sections).toHaveLength(2);
  expect(input.artifact.sections[0]!.blocks[0]).toMatchObject({ markdown: "# Panel\n\nPass a label." });
  expect(input.artifact.sections[1]!.blocks.map(block => block.markdown).join("\n\n"))
    .toBe("## Declared properties\n\n" + api);
  expect(input.artifact.sections[1]!.blocks.flatMap(block => block.references)).toEqual([reference]);
  expect(JSON.stringify(input.artifact)).not.toContain("fact_refs");
  applySelectedPageTemplate({ ...input, articleKey: "panel-guide",
    semanticVariables: { api: { value: api, references: [reference] } } });
  expect(input.artifact.sections).toHaveLength(2);
});

test("missing slots and unknown slots retain authored content without blocking production", async () => {
  const input = await fixture();
  const before = structuredClone(input.artifact.sections);
  const diagnostics: Array<{ code: string; message: string }> = [];
  applySelectedPageTemplate({ ...input, diagnostics });
  expect(input.artifact.sections).toEqual(before);
  applySelectedPageTemplate({ ...input, diagnostics, semanticVariables: { other: "A proposed chapter." } });
  expect(input.artifact.sections).toEqual(before);
  expect(diagnostics.map(item => item.code)).toContain("template-unknown-writing-slot");
});

test("a string slot never inherits citations from another fragment", async () => {
  const input = await fixture();
  applySelectedPageTemplate({ ...input, articleKey: "panel-guide", semanticVariables: { api: "A general explanation." } });
  expect(input.artifact.sections.find(section => section.section_key === "panel-guide--api")!.blocks[0]!.references).toEqual([]);
});

test("a slot keeps its own references and never truncates long prose", async () => {
  const input = await fixture();
  input.template.contract.maximum_rendered_bytes = 1;
  const text = "A detailed explanation. ".repeat(50);
  applySelectedPageTemplate({ ...input, articleKey: "panel-guide", semanticVariables: { api: { value: text, references: [reference] } } });
  const block = input.artifact.sections.find(section => section.section_key === "panel-guide--api")!.blocks
    .find(item => item.references.length > 0)!;
  expect(block.markdown).toContain(text.trim());
  expect(block.references).toEqual([reference]);
});

test("separate template paragraphs can cite six regions while a single paragraph is capped at three", async () => {
  const input = await fixture();
  const api = input.template.contract.sections.find(section => section.section_key === "api")!;
  const variable = input.template.contract.variables.find(item => item.id === "api")!;
  input.template.contract.variables = [{ ...variable, id: "first" }, { ...variable, id: "second" }];
  input.template.contract.sections = [{ ...api, variable_ids: ["first", "second"] }];
  input.template.section_bodies.api = "## API\n\n{{variable:first}}\n\n{{variable:second}}";
  const regions = (offset: number) => [1, 2, 3].map(line => ({ ...reference,
    locator: { ...reference.locator, start_line: line + offset, end_line: line + offset } }));
  const semanticVariables = { first: { value: "First paragraph", references: regions(0) },
    second: { value: "Second paragraph", references: regions(3) } };
  applySelectedPageTemplate({ ...input, semanticVariables });
  const blocks = input.artifact.sections.find(section => section.section_key === "api")!.blocks;
  expect(blocks.map(block => block.references.length)).toEqual([0, 3, 3]);
  expect(blocks.map(block => block.markdown).join("\n\n")).toBe("## API\n\nFirst paragraph\n\nSecond paragraph");
  const ids = blocks.map(block => block.block_id);
  semanticVariables.first.value = "Updated first paragraph";
  applySelectedPageTemplate({ ...input, semanticVariables });
  expect(input.artifact.sections.find(section => section.section_key === "api")!.blocks.map(block => block.block_id)).toEqual(ids);
  input.template.section_bodies.api = "{{variable:first}} and {{variable:second}}";
  expect(() => applySelectedPageTemplate({ ...input, semanticVariables })).toThrow();
});
