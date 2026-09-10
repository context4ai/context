import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadProvider } from "@c4a/agent-graph";

const ROOT = resolve(import.meta.dir, "../../../..");
const DOC_ROOT = resolve(ROOT, "packages/context/docs/guides");
const PLUGIN_ROOT = resolve(ROOT, "plugins/context");
const WORKFLOW_ROOT = resolve(ROOT, "packages/context-cli/context-workflow");

async function body(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("0.7.0 Indexer authoring documentation", () => {
  test("documents registry-only selection and all customization outcomes", async () => {
    const guide = await body(resolve(DOC_ROOT, "indexer-provider-and-customization.md"));
    for (const outcome of [
      "indexer-provider-required",
      "indexer-provider-unavailable",
      "indexer-customization-required",
      "indexer-customization-invalid",
      "indexer-customization-upstream-changed",
    ]) {
      expect(guide).toContain(`\`${outcome}\``);
    }
  });

  test("ships the required customization guide and linked manuals with its workflow Actions", async () => {
    const provider = await loadProvider(resolve(ROOT, "packages/context-cli/dist/providers/context/manifest.json"));
    const guideRef = "resources/contracts/indexer-provider-guide.yaml";
    const skills = new Set([
      "skills/run-indexer-lifecycle/SKILL.md",
      "skills/configure-indexer-providers/SKILL.md",
      "skills/propose-indexer-customization/SKILL.md",
      "skills/prepare-indexer-customization-project/SKILL.md",
    ]);
    const found = new Set<string>();
    for (const graph of provider.graphs.values()) {
      for (const node of graph.definition.nodes) {
        if (node.kind !== "action") continue;
        const action = provider.actions.get(resolve(provider.root, node.action));
        const skill = action?.definition.skill;
        if (skill === undefined || !skills.has(skill)) continue;
        found.add(skill);
        expect(node.resources?.required).toContain(guideRef);
      }
    }
    expect(found).toEqual(skills);
    const guide = provider.resources.get(resolve(provider.root, guideRef));
    if (guide === undefined) throw new Error("required Provider guide is absent from the bundle");
    const pending = [guide.contentPath];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      expect(provider.files.has(file)).toBe(true);
      const markdown = await body(file);
      const relative = file.split("/references/")[1];
      if (relative === undefined) throw new Error("Provider guide does not identify its bundled manual");
      expect(markdown).toBe(await body(resolve(ROOT, "packages/context/docs", relative)));
      for (const match of markdown.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/gu)) {
        if (!/^https?:/u.test(match[1]!)) pending.push(resolve(dirname(file), match[1]!));
      }
    }
  });

  test("Provider skills link to readable authoring guides", async () => {
    for (const [skill, guide] of [
      ["context-code-indexer", "code-indexer-skill-authoring.md"],
      ["context-markdown-indexer", "markdown-indexer-skill-authoring.md"],
    ]) {
      expect(await body(resolve(PLUGIN_ROOT, `skills/${skill}/SKILL.md`)))
        .toContain(`docs/guides/${guide}`);
      expect((await body(resolve(DOC_ROOT, guide!))).trim().length).toBeGreaterThan(0);
    }
  });

  test("publishes the complete Agent step and instruction materialization contracts", async () => {
    const agentStep = JSON.parse(await body(resolve(
      WORKFLOW_ROOT,
      "schemas/indexer-agent-step-result.schema.json",
    ))) as {
      $defs: Record<string, unknown>;
    };
    for (const definition of [
      "providerSelection",
      "providerResolution",
      "providerProgramAuthorization",
      "partitionBatch",
      "authorBatch",
      "postAuthor",
      "structureReview",
      "layoutConfirmation",
    ]) {
      expect(agentStep.$defs[definition]).toBeDefined();
    }

    const materialized = JSON.parse(await body(resolve(
      WORKFLOW_ROOT,
      "schemas/indexer-materialized-resource.schema.json",
    ))) as {
      properties: {
        resources: {
          items: { properties: { kind: { enum: string[] } } };
        };
      };
    };
    expect(materialized.properties.resources.items.properties.kind.enum).toEqual([
      "provider",
      "template",
      "composer",
      "customization-append",
    ]);

    // Payload structure is checked above and exercised by Agent-step integration
    // tests. Do not make the author's natural-language instructions a snapshot.

  });
});
