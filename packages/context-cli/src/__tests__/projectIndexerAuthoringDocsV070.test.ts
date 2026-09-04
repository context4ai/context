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
    for (const anchor of [
      "registry-only by default",
      "Six-level customization ladder",
      "Provider only",
      "Config",
      "Instructions append",
      "Template override",
      "Program extension",
      "Restricted replace",
      "Upgrade and conflict handling",
      "Debugging commands",
      "Completion check",
    ]) {
      expect(guide).toContain(anchor);
    }
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

  test("covers all 23 shared Code author contracts", async () => {
    const guide = await body(resolve(DOC_ROOT, "code-indexer-skill-authoring.md"));
    const numbered = [...guide.matchAll(/^([1-9]|1[0-9]|2[0-3])\. \*\*/gmu)]
      .map((match) => Number(match[1]));
    expect(numbered).toEqual(Array.from({ length: 23 }, (_, index) => index + 1));
    for (const anchor of [
      "context-indexer.yaml",
      "Artifact Bundles",
      "Reader questions",
      "Material gaps",
      "Provider only → config",
      "controlled execution",
      "forward tests",
    ]) {
      expect(guide).toContain(anchor);
    }
    expect(await body(resolve(PLUGIN_ROOT, "skills/context-code-indexer/SKILL.md")))
      .toContain("docs/guides/code-indexer-skill-authoring.md");
  });

  test("covers Markdown capture, placement, reuse, editorial, gap and incremental boundaries", async () => {
    const guide = await body(resolve(DOC_ROOT, "markdown-indexer-skill-authoring.md"));
    for (const anchor of [
      "Capture before semantics",
      "Activation and source roles",
      "Section projection and collection mapping",
      "Reusing Code Nodes",
      "Artifact and Section planning",
      "Editorial policy",
      "Missing material",
      "Section/Artifact-local",
      "Source authorization, capture revision safety",
    ]) {
      expect(guide).toContain(anchor);
    }
    expect(await body(resolve(PLUGIN_ROOT, "skills/context-markdown-indexer/SKILL.md")))
      .toContain("docs/guides/markdown-indexer-skill-authoring.md");
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
      "partition",
      "author",
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

    const agentSkill = await body(resolve(
      WORKFLOW_ROOT,
      "skills/run-indexer-agent-step/SKILL.md",
    ));
    for (const exactProjectionRule of [
      "`fact_ref` = the `fact` item's `value.fact_ref`",
      "`fact_kind` = the `fact` item's `value.kind`",
      "`value` = the `fact` item's `value.payload` exactly",
      "matching `selected-fact`",
    ]) {
      expect(agentSkill).toContain(exactProjectionRule);
    }
    expect(agentSkill).toMatch(
      /existing dependency, schema,\s+owner, scope, and workset validation/u,
    );
  });
});
