import { describe, expect, test } from "bun:test";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { indexerTemplateContractSchema } from "@c4a/context";
import { splitFrontmatter } from "../project/indexerTemplateRendering.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
const PLUGIN_ROOT = join(REPOSITORY_ROOT, "plugins", "context");
const CODE_INDEXER_ROOT = join(PLUGIN_ROOT, "skills", "context-code-indexer");
const MARKDOWN_INDEXER_ROOT = join(PLUGIN_ROOT, "skills", "context-markdown-indexer");
const ENTRY_PATH = ["skills", "context", "SKILL.md"] as const;
const WORKFLOW_ROOT = join(PACKAGE_ROOT, "context-workflow");
const SDK_DOCS_ROOT = join(PACKAGE_ROOT, "..", "context", "docs");

async function read(...segments: string[]): Promise<string> {
  return readFile(join(...segments), "utf8");
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return files;
    }
    throw error;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

describe("plugin prompt and workflow resource contract", () => {
  // Revision, mode/gate and continuation behavior is exercised by the
  // projectDocumentRevision and projectWorkflow suites, not prose snapshots.

  test("plugin README exposes only current public entrypoints", async () => {
    const readmes = [
      await read(PLUGIN_ROOT, "README.md"),
      await read(PLUGIN_ROOT, "README_CN.md"),
    ];
    for (const readme of readmes) {
      for (const snippet of [
        "context",
        "workflow",
      ]) {
        expect(readme, snippet).toContain(snippet);
      }
      expect(readme).not.toContain("skill-");
      for (const retired of [
        "context-capture",
        "context-align",
        "context-compile",
        "context-build",
        "context-query",
        "context-drop",
      ]) {
        expect(readme, retired).not.toContain(retired);
      }
    }
  });

  test("public entry sources stay thin and delegate lifecycle authority to Context", async () => {
    const pluginEntries = await readdir(PLUGIN_ROOT, { withFileTypes: true });
    expect(pluginEntries.some((entry) => entry.isDirectory() && entry.name === "skills")).toBe(true);

    const continuation = await read(PLUGIN_ROOT, ...ENTRY_PATH);
    expect(continuation).toContain("next_action.command");
    expect(continuation).toContain("workflow.current");
    expect(continuation).not.toContain("references/internal-procedures");
    expect(continuation).not.toMatch(/`(?:context:)?skill-[a-z-]+`/u);
    expect(continuation).toContain("context entry");
    expect(continuation).toContain("resources.required");
    expect(continuation).toContain("context plugin install");
  });

  test("human-gate dialogue is route-selected instead of embedded in CLI branches", async () => {
    const graph = await read(WORKFLOW_ROOT, "graphs", "workspace.yaml");
    for (const file of [
      "human-gates.md",
      "source-boundary.md",
      "document-capture.md",
      "knowledge-review.md",
      "package-output.md",
      "evidence-maintenance.md",
      "workflow-mode-after-creation.md",
    ]) {
      const resourcePath = `resources/dialogue/${file}`;
      expect(graph, resourcePath).toContain(resourcePath);
      expect((await read(WORKFLOW_ROOT, resourcePath)).trim().length).toBeGreaterThan(0);
    }
  });

  test("semantic planning has one Provider-owned source", async () => {
    expect(await listFiles(join(WORKFLOW_ROOT, "resources", "semantic", "align"))).toEqual([]);
    const planning = await read(MARKDOWN_INDEXER_ROOT, "references", "semantic-planning.md");
    const structure = await read(
      MARKDOWN_INDEXER_ROOT,
      "references",
      "structure-and-artifacts.md",
    );
    expect(planning.trim().length).toBeGreaterThan(0);
    expect(structure.trim().length).toBeGreaterThan(0);
  });

  test("code-index archetype templates live only in the Provider Bundle", async () => {
    const manifest = YAML.parse(await read(CODE_INDEXER_ROOT, "context-indexer.yaml")) as {
      provider: { templates: Array<{ path: string; kind: string }> };
    };
    expect(manifest.provider.templates.length).toBeGreaterThan(0);
    for (const template of manifest.provider.templates) {
      const content = await read(CODE_INDEXER_ROOT, template.path);
      expect(content.trim().length, template.path).toBeGreaterThan(0);
      if (template.kind === "page-program") {
        // Parse executable material; prose headings and formatting are not contracts.
        expect(() => indexerTemplateContractSchema.parse(splitFrontmatter(content).metadata),
          template.path).not.toThrow();
      }
    }
  });

  test("workflow graph delegates semantic indexing through the sole lifecycle Skill", async () => {
    const graph = YAML.parse(await read(WORKFLOW_ROOT, "graphs", "workspace.yaml")) as {
      nodes: Array<{ id: string; action?: string }>;
      edges: Array<{ from: string; to: string; kind?: string }>;
    };
    expect(graph.nodes.filter((node) => node.id === "run-indexer-lifecycle"))
      .toEqual([expect.objectContaining({ action: "actions/run-indexer-lifecycle.yaml" })]);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "review-current-batch", to: "close-approved-knowledge", kind: "gatedBy" }),
      expect.objectContaining({ from: "close-approved-knowledge", to: "choose-package-output" }),
    ]));
    expect(graph.edges.some((edge) =>
      (edge.from === "maintain-evidence" && edge.to === "close-approved-knowledge") ||
      (edge.from === "close-approved-knowledge" && edge.to === "revise-document")
    )).toBe(false);
  });

  test("route-selected SDK manuals remain complete mirrors of the public docs", async () => {
    const manuals = [
      ["reference/code-extractors.md", "reference/code-extractors.md"],
      ["reference/project-api.md", "reference/project-api.md"],
      ["guides/package-outputs.md", "guides/package-outputs.md"],
      ["guides/lark-resources.md", "guides/lark-resources.md"],
      ["reference/package-templates.md", "reference/package-templates.md"],
      ["reference/template-variables.md", "reference/template-variables.md"],
    ] as const;
    for (const [sdkPath, workflowPath] of manuals) {
      const sdk = await read(SDK_DOCS_ROOT, sdkPath);
      const resource = await read(
        WORKFLOW_ROOT,
        "resources",
        "manuals",
        workflowPath,
      );
      const body = resource.replace(/^---\n[\s\S]*?\n---\n\n?/u, "");
      expect(body.trimEnd(), workflowPath).toBe(sdk.trimEnd());
    }
  });

  test("every workflow resource selected by a graph exists", async () => {
    const resourcesRoot = join(WORKFLOW_ROOT, "resources");
    const graph = (await Promise.all([
      "workspace.yaml",
      "indexer.yaml",
    ].map((name) => read(WORKFLOW_ROOT, "graphs", name)))).join("\n");
    const referenced = [...graph.matchAll(/(?:^|[\s[])resources\/([a-z0-9_./-]+)/gmu)]
      .map((match) => match[1]!.replace(/[\],}]$/u, ""));
    expect(referenced.length).toBeGreaterThan(10);
    for (const path of new Set(referenced)) {
      expect((await stat(join(resourcesRoot, path))).isFile(), path).toBe(true);
    }
  });

  test("retired migration commands and stage-skill shells are absent", async () => {
    const sourceFiles = [
      ...await listFiles(join(PACKAGE_ROOT, "src")),
      ...await listFiles(join(PACKAGE_ROOT, "plugin")),
      ...await listFiles(WORKFLOW_ROOT),
      ...await listFiles(SDK_DOCS_ROOT),
    ].filter((file) =>
      !file.includes(`${join("src", "__tests__")}${"/"}`) &&
      !file.endsWith(".png")
    );
    for (const file of sourceFiles) {
      const body = await readFile(file, "utf8");
      expect(body, file).not.toContain("migrate-codegraph-refs");
      expect(body, file).not.toMatch(/`context:skill-[a-z-*]+`/u);
    }
  });

  test("workflow Markdown resources have no broken relative links", async () => {
    for (const file of (await listFiles(join(WORKFLOW_ROOT, "resources")))
      .filter((path) => path.endsWith(".md"))) {
      const body = await readFile(file, "utf8");
      for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1]!.replace(/^<|>$/gu, "").split("#")[0]!;
        if (
          target.length === 0 ||
          target.includes("{{") ||
          target.startsWith("/") ||
          /^[a-z]+:/iu.test(target)
        ) {
          continue;
        }
        await expect(
          stat(resolve(dirname(file), target)),
          `${file} links to missing ${target}`,
        ).resolves.toBeDefined();
      }
    }
  });
});
