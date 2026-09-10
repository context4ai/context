import { expandArticleBlueprint } from "../project/indexerArticleBlueprint.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import YAML from "yaml";
import { indexerTemplateContractSchema, type IndexerArtifactResult } from "@c4a/context";
import { splitFrontmatter, parseSectionBodies, validateTemplateBody } from "../project/indexerTemplateRendering.js";
import { applySelectedPageTemplate } from "../project/indexerPageTemplate.js";

for (const provider of ["context-code-indexer", "context-markdown-indexer", "context-note-indexer", "context-sessions-indexer"]) {
  test(provider + " distributes executable article programs with source-bound optional slots", async () => {
    const root = join(import.meta.dir, "../../../../plugins/context/skills", provider);
    const manifest = YAML.parse(await readFile(join(root, "context-indexer.yaml"), "utf8"));
    const programs = manifest.provider.templates.filter((item: { guidance_path?: string }) => item.guidance_path);
    expect(programs.length).toBeGreaterThan(0);
    for (const entry of programs) {
      const source = splitFrontmatter(await readFile(join(root, entry.path), "utf8"));
      const shared = expandArticleBlueprint(source.metadata, entry);
      const contract = shared?.contract ?? indexerTemplateContractSchema.parse(source.metadata);
      const template = shared ?? { contract, section_bodies: parseSectionBodies(source.body) };
      validateTemplateBody(contract, template.section_bodies);
      expect(contract.profile).toBe(entry.profile);
      expect(contract.reader_goal).toBe(entry.reader_goal);
      expect((await readFile(join(root, entry.guidance_path), "utf8")).length).toBeGreaterThan(0);
      const makeArtifact = (): Extract<IndexerArtifactResult["artifacts"][number], {representation: "sections"}> => ({
        artifact_id: "reader-entry", artifact_kind: "content", artifact_policy_variant: contract.applicability.artifact_policy_variants[0]!,
        representation: "sections", sections: [{ section_key: "reader-entry--introduction", owner_indexer_id: "fixture",
          document_kind: "reference", reader_goal: contract.reader_goal, artifact_kind: "content",
          blocks: [{ block_id: "intro", layer: "semantic-prose", markdown: "# Reader entry", evidence_refs: ["evidence:source"] }] }],
      });
      const variables = Object.fromEntries(contract.variables.filter(variable => variable.content_layer === "semantic-prose")
        .map(variable => [variable.id, { value: "Inspect the documented source entry for " + variable.id + ".", evidence_refs: ["evidence:source"] }]));
      const artifact = makeArtifact();
      applySelectedPageTemplate({ artifact, template, articleKey: "reader-entry", facts: [], semanticVariables: variables });
      const markdown = artifact.sections.flatMap(section => section.blocks.flatMap(block => block.layer === "semantic-prose" ? [block.markdown] : [])).join("\n");
      for (const variable of Object.values(variables)) expect(markdown).toContain(variable.value);
      expect(markdown).not.toContain("{{variable:");
      expect(new Set(artifact.sections.map(section => section.section_key)).size).toBe(artifact.sections.length);
      if (entry.guidance_path.endsWith("/l03.md")) {
        // Each form has its own reading sequence; shared caveats must not
        // displace setup or turn a system map into a token table.
        for (const keys of [
          ["scope", "packages", "foundations", "components", "configuration", "adoption", "references"],
          ["purpose", "catalog", "mapping", "consumption", "rules", "platforms", "references"],
          ["environment", "globals", "inheritance", "resources", "ssr", "platforms", "verification"],
        ]) {
          const variant = makeArtifact();
          applySelectedPageTemplate({ artifact: variant, template, articleKey: "reader-entry", facts: [],
            semanticVariables: Object.fromEntries(keys.map(key => [key, variables[key]!])) });
          expect(variant.sections.slice(1).map(section => section.section_key))
            .toEqual(keys.map(key => `reader-entry--${key}`));
        }
      }
      const omitted = makeArtifact();
      const original = structuredClone(omitted.sections);
      applySelectedPageTemplate({ artifact: omitted, template, articleKey: "reader-entry", facts: [] });
      expect(omitted.sections).toEqual(original);
    }
  });
}
