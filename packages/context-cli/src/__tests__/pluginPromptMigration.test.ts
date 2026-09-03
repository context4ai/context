import { describe, expect, test } from "bun:test";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  test("document revision stays one sibling-page contract across CLI, Route, and Agent guidance", async () => {
    const [
      command,
      graph,
      action,
      procedure,
      registration,
      classification,
      storage,
      optimization,
      hostPlans,
    ] = await Promise.all([
      read(PLUGIN_ROOT, ...ENTRY_PATH),
      read(WORKFLOW_ROOT, "graphs", "workspace.yaml"),
      read(WORKFLOW_ROOT, "actions", "revise-document.yaml"),
      read(WORKFLOW_ROOT, "resources", "procedures", "document-revision.md"),
      read(PACKAGE_ROOT, "src", "commands", "documentOptimizationCommands.ts"),
      read(PACKAGE_ROOT, "src", "project", "knowledgeFileClassification.ts"),
      read(PACKAGE_ROOT, "src", "project", "documentOptimizationStorage.ts"),
      read(PACKAGE_ROOT, "src", "project", "documentOptimization.ts"),
      read(PACKAGE_ROOT, "src", "project", "workflow", "workflowHostPlans.ts"),
    ]);

    expect(command).toContain('context revise "<the user\'s page title, approved path, ViewRef, or wording>"');
    expect(command).toContain("knowledge/**/*__revision.md");
    expect(command).toContain("route.document-revision.requested");
    expect(graph).toContain("id: revise-document");
    expect(graph).toContain("reasonCode: route.document-revision.requested");
    expect(action).toContain("handler: context.document-revision.next");
    expect(hostPlans).toContain('command("context optimize-docs revise-current --format json"');
    expect(procedure).toContain("sibling `__revision.md` page");
    expect(registration).toContain('program.command("revise <target>")');
    expect(classification).toContain('DOCUMENT_REVISION_SUFFIX = "__revision.md"');
    expect(storage).toContain('join(projectRoot, "knowledge", documentRevisionPathForApprovedPath(approvedPath))');

    for (const source of [
      command,
      graph,
      action,
      procedure,
      registration,
      classification,
      storage,
      optimization,
      hostPlans,
    ]) {
      expect(source).not.toContain("overlays/");
      expect(source).not.toContain("migrateLegacyDocumentOptimization");
    }
  });

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
    expect(continuation).toContain("context status");
    expect(continuation).toContain("workflow.current");
    expect(continuation).not.toContain("references/internal-procedures");
    expect(continuation).not.toMatch(/`(?:context:)?skill-[a-z-]+`/u);
    expect(continuation).toContain("context entry");
    expect(continuation).toContain("knowledge management tool built for Agent knowledge workflows");
    expect(continuation).toContain("Feishu/Lark documents");
    expect(continuation).toContain("structured, traceable knowledge");
    expect(continuation).toContain("knowledge packages, LLM-ready documents, or Agent Skills");
    expect(continuation).toContain("code-indexing capabilities");
    expect(continuation).toContain("workflow.current");
    expect(continuation).toContain("resources.required");
    expect(continuation).toContain("without an additional status call");
    expect(continuation).toContain("revision and");
    expect(continuation).toMatch(/never replaces\s+the workspace\s+Route/u);
    expect(continuation).toContain("npm install -g @c4a/context-cli@latest");
    expect(continuation).toContain("context plugin install");
    expect(continuation).toContain("shell exit 127");
    expect(continuation).toContain("Do not run an installation preflight");
    expect(continuation).toContain("context init ... --debug");
    expect(continuation).toContain("do not run a workspace-only debug command");
    expect(continuation).toContain("For an existing workspace, run `context debug enable`");
    expect(continuation).toContain("downstream distribution step outside the Context Route");
    expect(continuation).toContain("Context itself does not publish to a hosted service");
  });

  test("source and gate discipline lives in selected workflow procedures", async () => {
    const source = await read(WORKFLOW_ROOT, "resources", "procedures", "source-boundary.md");
    const capture = await read(WORKFLOW_ROOT, "resources", "procedures", "document-capture.md");
    const indexerLifecycle = await read(
      WORKFLOW_ROOT,
      "skills",
      "run-indexer-lifecycle",
      "SKILL.md",
    );
    const codeIndexer = await read(CODE_INDEXER_ROOT, "references", "indexer.md");
    const review = await read(WORKFLOW_ROOT, "resources", "procedures", "knowledge-review.md");
    const detailed = await read(WORKFLOW_ROOT, "resources", "procedures", "source-capture-detailed.md");

    expect(source).toContain("calendar date identifies one capture batch");
    expect(source).toContain("module identifies one concrete");
    expect(source).toContain("Do not infer this boundary");
    expect(source).toContain("mechanical identity resolution");
    expect(source).toContain("do not ask for\ntheir remote URLs");
    expect(source).toContain("separate authority");
    expect(capture).toContain("does not classify, summarize, approve, or build");
    expect(capture).toContain("Never hand-write or repair captured snapshots");
    expect(capture).toContain("Never treat one\nsuccessful module as completion");
    expect(indexerLifecycle).toContain("sole Context registry-and-Provider indexing route");
    expect(indexerLifecycle).toContain("The Indexer\nGraph is the authority");
    expect(codeIndexer).toContain("For author work, produce exactly one Result");
    expect(codeIndexer).toContain("Context independently validates");
    expect(review).toMatch(/complete current candidate set|complete\s+current batch/u);
    for (const invariant of [
      "Capture is entirely CLI-driven",
      "Never hand-write captured source snapshots",
      "Do not run hand-written dependency preflight commands",
      "Route by source boundary",
      "Do not discover files with `find` / `ls`",
      "Missing Dependency Recovery",
      "stable origin path, not its H1/title",
    ]) {
      expect(detailed, invariant).toContain(invariant);
    }
  });

  test("human-gate dialogue is route-selected instead of embedded in CLI branches", async () => {
    const graph = await read(WORKFLOW_ROOT, "graphs", "workspace.yaml");
    const dialogue = [
      ["human-gates.md", ["user's conversation language", "raw TypeScript"]],
      ["source-boundary.md", ["whole repository/subspace", "`include`"]],
      ["document-capture.md", ["permission to read", "documentation site"]],
      ["knowledge-review.md", ["exact Payload", "fully managed operation"]],
      ["package-output.md", ["output", "package"]],
      ["evidence-maintenance.md", ["source evidence", "content refresh"]],
      ["workflow-mode-after-creation.md", ["Ordinary review mode", "about 40% slower"]],
    ] as const;

    for (const [file, snippets] of dialogue) {
      const resourcePath = `resources/dialogue/${file}`;
      const body = await read(WORKFLOW_ROOT, resourcePath);
      expect(graph, resourcePath).toContain(resourcePath);
      for (const snippet of snippets) {
        expect(body, `${file}:${snippet}`).toContain(snippet);
      }
    }

    const projectSourceFiles = (await listFiles(join(PACKAGE_ROOT, "src", "project")))
      .filter((file) => file.endsWith(".ts"));
    for (const file of projectSourceFiles) {
      const body = await readFile(file, "utf8");
      expect(body, file).not.toMatch(/\b(?:Ask|Tell) the user\b|Human gate:/u);
      expect(body, `${file} must not declare a workspace human gate`).not.toMatch(
        /\bhuman_gate:\s*true\b|\bdecision_options\s*:/u,
      );
      expect(body, `${file} must not select another workspace lifecycle stage`).not.toMatch(
        /\bkind:\s*"(?:review_candidates|confirm_structure|capture-before-document-classification|investigate-and-align)"\b/u,
      );
    }
  });

  test("execution mode is asked once and reviewed HTML reports reach the final summary", async () => {
    const [
      command,
      afterCreation,
      afterCapture,
      reviewDialogue,
      reviewProcedure,
      closeProcedure,
    ] = await Promise.all([
      read(PLUGIN_ROOT, ...ENTRY_PATH),
      read(WORKFLOW_ROOT, "resources", "dialogue", "workflow-mode-after-creation.md"),
      read(WORKFLOW_ROOT, "resources", "dialogue", "workflow-mode-after-capture.md"),
      read(WORKFLOW_ROOT, "resources", "dialogue", "knowledge-review.md"),
      read(WORKFLOW_ROOT, "resources", "procedures", "knowledge-review.md"),
      read(WORKFLOW_ROOT, "resources", "procedures", "close-and-build.md"),
    ]);

    expect(command).toContain("state a short execution\nplan, then ask the user to choose once");
    expect(command).toContain("combine\nthe mode choice with that question");
    expect(command).toContain("do not ask again after initialization");
    expect(afterCreation).toContain("no earlier mode question was\nasked");
    expect(afterCreation).toContain("one-time conversation choice");
    expect(afterCapture).toContain("no earlier mode question was\nasked");
    expect(afterCapture).toContain("without a reminder or another confirmation");

    for (const source of [command, reviewDialogue, reviewProcedure, closeProcedure]) {
      expect(source).toMatch(/exact (?:HTML )?report (?:URL|reference)/u);
      expect(source).toMatch(/final completion\s+summary/u);
    }
    expect(command).toContain("`Review reports` section");
    expect(closeProcedure).toContain("fully managed or force approval");
  });

  test("semantic planning has one Provider-owned source", async () => {
    expect(await listFiles(join(WORKFLOW_ROOT, "resources", "semantic", "align"))).toEqual([]);
    const planning = await read(MARKDOWN_INDEXER_ROOT, "references", "semantic-planning.md");
    const structure = await read(
      MARKDOWN_INDEXER_ROOT,
      "references",
      "structure-and-artifacts.md",
    );
    expect(planning).toContain("Source, subject, and claim planning");
    expect(planning).toContain("On\na stale workset");
    expect(structure).toContain("Section first, Artifact when justified");
    expect(structure).toContain("Candidate resolution");

    const detailedCapture = await read(
      WORKFLOW_ROOT,
      "resources",
      "procedures",
      "source-capture-detailed.md",
    );
    expect(
      Buffer.byteLength(detailedCapture, "utf8"),
      "the full source-capture procedure must remain in the workflow bundle",
    ).toBeGreaterThan(13_000);
  });

  test("code-index archetype templates live only in the Provider Bundle", async () => {
    const manifest = await read(CODE_INDEXER_ROOT, "context-indexer.yaml");
    const templates = await readdir(join(CODE_INDEXER_ROOT, "templates"));
    expect(templates.length).toBeGreaterThan(10);
    expect(manifest).toContain("provider:");
    for (const file of templates) {
      const body = await read(CODE_INDEXER_ROOT, "templates", file);
      expect(body, file).toContain("Evidence pass");
      expect(body, file).toContain("Questions the knowledge must answer");
    }
  });

  test("workflow graph delegates semantic indexing through the sole lifecycle Skill", async () => {
    const graph = await read(WORKFLOW_ROOT, "graphs", "workspace.yaml");
    expect(graph).toContain("id: run-indexer-lifecycle");
    expect(graph).toContain("actions/run-indexer-lifecycle.yaml");
    expect(graph).not.toContain("resources/semantic/align/");
    expect(graph).not.toContain("resources/semantic/code-index/");
    expect(graph).toContain("resources/procedures/source-capture-detailed.md");
    expect(graph).toContain("- { from: apply-managed-review, to: close-approved-knowledge }");
    expect(graph).toContain("- { from: close-approved-knowledge, to: choose-package-output }");
    expect(graph).not.toContain("- { from: maintain-evidence, to: close-approved-knowledge }");
    expect(graph).not.toContain("- { from: close-approved-knowledge, to: revise-document }");

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
