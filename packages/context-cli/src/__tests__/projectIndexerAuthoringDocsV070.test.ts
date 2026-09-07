import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

  test("exposes the customization guide from root Skill, generated command and Actions", async () => {
    const sources = await Promise.all([
      body(resolve(PLUGIN_ROOT, "skills/context/SKILL.md")),
      body(resolve(PLUGIN_ROOT, "repo-install/claude/commands/context.md")),
      body(resolve(
        WORKFLOW_ROOT,
        "skills/configure-indexer-providers/SKILL.md",
      )),
      body(resolve(
        WORKFLOW_ROOT,
        "skills/propose-indexer-customization/SKILL.md",
      )),
      body(resolve(
        WORKFLOW_ROOT,
        "skills/prepare-indexer-customization-project/SKILL.md",
      )),
    ]);
    for (const source of sources) {
      expect(source).toContain(
        "docs/guides/indexer-provider-and-customization.md",
      );
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
