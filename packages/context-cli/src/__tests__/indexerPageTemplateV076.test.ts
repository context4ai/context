import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { indexerTemplateContractSchema, renderIndexerDeterministicFacts, materializeIndexerStructuredContent,
  type IndexerArtifactResult, type IndexerArtifactFact } from "@c4a/context";
import { applySelectedPageTemplate } from "../project/indexerPageTemplate.js";
import { splitFrontmatter, parseSectionBodies } from "../project/indexerTemplateRendering.js";

test("selected page program combines source-backed API reference and semantic prose in one Artifact", async () => {
  const source = await readFile(join(import.meta.dir,
    "../../../../plugins/context/skills/context-code-indexer/templates/component-library-usage-guide.md"), "utf8");
  const parsed = splitFrontmatter(source);
  const template = { contract: indexerTemplateContractSchema.parse(parsed.metadata), section_bodies: parseSectionBodies(parsed.body) };
  // A local override may change the heading without replacing accepted prose.
  template.section_bodies.api = template.section_bodies.api!.replace("## API", "## Declared properties");
  const artifact: Extract<IndexerArtifactResult["artifacts"][number], { representation: "sections" }> = {
    artifact_id: "panel-guide", artifact_kind: "content", artifact_policy_variant: "standard", representation: "sections",
    sections: [{ section_key: "usage", owner_indexer_id: "widgets", document_kind: "usage-guide",
      reader_goal: "integrate-capability", artifact_kind: "content", blocks: [{ block_id: "usage-body",
        layer: "semantic-prose", markdown: "# Panel\n\nPass a label when rendering the panel.", evidence_refs: ["evidence:panel"] }] }],
  };
  const fact: IndexerArtifactFact = { fact_ref: "fact:panel", fact_kind: "symbol", subject_key: {
    protocol: "context.subject-key/v1", namespace: "widgets", kind: "component", local_key: "panel" },
    evidence_refs: ["evidence:panel"], value: { name: "Panel", members: [
      { name: "label", typeAnnotation: "string", optional: false, readonly: true },
      { name: "mode", typeAnnotation: '"inline" | "block"', optional: true, defaultValue: '"inline"' },
    ] },
  };
  const derived = applySelectedPageTemplate({ artifact, template, facts: [fact] });
  expect(artifact.template_id).toBe("component-library-usage-guide");
  expect(artifact.sections).toHaveLength(2);
  expect(artifact.sections[0]?.blocks[0]).toMatchObject({ markdown: "# Panel\n\nPass a label when rendering the panel." });
  expect(derived[0]?.evidence_refs).toEqual(["evidence:panel"]);
  const markdown = artifact.sections.flatMap((section) => section.blocks.map((block) => block.layer === "semantic-prose"
    ? block.markdown : renderIndexerDeterministicFacts({ renderer: block.renderer,
      facts: derived.filter((item) => block.fact_refs.includes(item.fact_ref)) }))).join("\n");
  expect(markdown).toContain("## Declared properties");
  expect(markdown).toContain("| Panel | label | string | required | unknown | readonly |");
  expect(markdown).toContain("&#124;");
  expect(markdown).not.toContain("fact:");
  expect(markdown).not.toContain("sha256:");
  const props: IndexerArtifactFact = { ...fact, fact_ref: "fact:props", value: {
    name: "PanelProps", kind: "type", file: "panel.tsx", visibility: "exported",
    members: [{ name: "mode", kind: "prop", typeAnnotation: "string", defaultValue: "old" }],
  } };
  const supporting: IndexerArtifactFact = { ...fact, fact_ref: "fact:implementation", evidence_refs: ["evidence:implementation"], value: {
    name: "Panel", kind: "component", file: "panel.tsx", visibility: "exported", propsType: "PanelProps",
    members: [{ name: "mode", kind: "prop", typeAnnotation: "string", defaultValue: "new" }],
  } };
  const repaired = structuredClone(artifact);
  repaired.sections = repaired.sections.slice(0, 1);
  applySelectedPageTemplate({ artifact: repaired, template, facts: [props], supportingFacts: [supporting] });
  const api = repaired.sections[1]!.blocks.find(block => block.layer === "deterministic-block")!;
  if (api.layer !== "deterministic-block") throw new Error("missing program block");
  expect(api.fact_refs).toEqual([props.fact_ref]);
  const final = materializeIndexerStructuredContent({ blocks: [api], facts: [props, supporting] })[0]!;
  expect(final.markdown).toContain("| new |");
  expect(final.markdown).not.toContain("| Panel | mode |");
  expect(final.evidence_refs).toContain("evidence:implementation");

});
