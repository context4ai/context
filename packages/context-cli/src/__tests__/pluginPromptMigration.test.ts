import { describe, expect, test } from "bun:test";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLUGIN_ROOT = join(PACKAGE_ROOT, "plugin");
const WORKFLOW_ROOT = join(PACKAGE_ROOT, "context-workflow");
const SDK_DOCS_ROOT = join(PACKAGE_ROOT, "..", "context", "docs");

async function read(...segments: string[]): Promise<string> {
  return readFile(join(...segments), "utf8");
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

describe("plugin prompt and workflow resource contract", () => {
  test("plugin README exposes only current public entrypoints", async () => {
    const readmes = [
      await read(PLUGIN_ROOT, "README.md"),
      await read(PLUGIN_ROOT, "README_CN.md"),
    ];
    for (const readme of readmes) {
      for (const snippet of [
        "init",
        "continue",
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
    expect(pluginEntries.some((entry) => entry.isDirectory() && entry.name === "skills")).toBe(false);

    for (const command of ["init.md", "continue.md"]) {
      const body = await read(PLUGIN_ROOT, "commands", command);
      expect(body, command).toContain("context status");
      expect(body, command).toContain("workflow.current");
      expect(body, command).not.toContain("references/internal-procedures");
      expect(body, command).not.toMatch(/`(?:context:)?skill-[a-z-]+`/u);
    }
    const continuation = await read(PLUGIN_ROOT, "commands", "continue.md");
    expect(continuation).toContain("workflow.current");
    expect(continuation).toContain("resources.required");
    expect(continuation).toContain("without an additional status call");
    expect(continuation).toContain("revision and");
    expect(continuation).toMatch(/never replaces\s+the workspace\s+Route/u);
  });

  test("source and gate discipline lives in selected workflow procedures", async () => {
    const source = await read(WORKFLOW_ROOT, "resources", "procedures", "source-boundary.md");
    const capture = await read(WORKFLOW_ROOT, "resources", "procedures", "document-capture.md");
    const extraction = await read(WORKFLOW_ROOT, "resources", "procedures", "code-extraction.md");
    const review = await read(WORKFLOW_ROOT, "resources", "procedures", "knowledge-review.md");
    const detailed = await read(WORKFLOW_ROOT, "resources", "procedures", "source-capture-detailed.md");

    expect(source).toContain("calendar date identifies one capture batch");
    expect(source).toContain("module identifies one concrete");
    expect(source).toContain("Do not infer this boundary");
    expect(source).toContain("separate authority");
    expect(capture).toContain("does not classify, summarize, approve, or build");
    expect(capture).toContain("Never hand-write or repair captured snapshots");
    expect(capture).toContain("Never treat one\nsuccessful module as completion");
    expect(extraction).toContain("`include` filters files inside a selected source");
    expect(extraction).toContain("scan mode");
    expect(extraction).toContain("AST-analyzed files");
    expect(extraction).toContain("Do not open Review while another extraction target");
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
      ["human-gates.md", ["user's conversation language", "placeholder commands"]],
      ["source-boundary.md", ["whole repository/subspace", "`include`"]],
      ["document-capture.md", ["permission to read", "documentation site"]],
      ["document-classification.md", ["mainline collection", "insufficient evidence"]],
      ["structure-confirmation.md", ["final staged HTML report", "multi-source round"]],
      ["code-extraction.md", ["preview", "multi-module round"]],
      ["knowledge-review.md", ["exact Payload", "fully managed operation"]],
      ["package-output.md", ["output", "package"]],
      ["evidence-maintenance.md", ["source evidence", "content refresh"]],
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

  test("phase source code does not duplicate the Provider semantic resource catalog", async () => {
    const types = await read(PACKAGE_ROOT, "src", "project", "proseAlignTypes.ts");
    expect(types).not.toContain("PROSE_ALIGN_REFERENCE_FILES");
    expect(types).not.toContain("PROSE_COMPILE_REFERENCE_FILES");
    expect(types).not.toContain("resources/semantic/align/");
    expect(types).not.toContain("resources/semantic/compile/");

    for (const scope of ["align", "compile"]) {
      const root = join(WORKFLOW_ROOT, "resources", "semantic", scope);
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const body = await readFile(join(root, entry.name), "utf8");
        expect(body, `${scope}/${entry.name}`).toMatch(
          /^---\n[\s\S]*?\napplies-to:\n(?:\s+- [a-z0-9_-]+\n)+[\s\S]*?\n---\n/u,
        );
      }
    }
  });

  test("semantic judgment resources are published outside skills and remain deep", async () => {
    const resources = [
      ["align", "structure-planning.md", ["Structure Planning Procedure", "context.structure.v1", "Keep cache-friendly prompt order"]],
      ["align", "gates.md", ["Node Type Order", "Fake Entity Gate", "Edge Gate"]],
      ["align", "density-profile.md", ["Evidence Density Selection", "`macro`", "`single_pass`"]],
      ["align", "candidate-resolution.md", ["Candidate Resolution Rules", "Stable References", "Keep unresolved"]],
      ["compile", "compile-actions.md", ["Section Kind Choice", "context.compile-actions.v1", "Do not write `content`"]],
      ["compile", "action-domain-gates.md", ["answerability", "No trigger Section"]],
      ["compile", "notes.md", ["Note snippets", "How to route a note snippet"]],
      ["compile", "refresh-and-update.md", ["Refresh and update", "Replacement vs `update` semantics"]],
      ["compile", "structural-challenges.md", ["Structural and ownership challenges", "When to challenge"]],
      ["compile", "compile-judgment.md", ["Verdict Meanings", "explicit user confirmation"]],
      ["compile", "semantic-judgment.md", ["Judgment Vocabulary", "Decision Routing"]],
      ["compile", "disposition-semantics.md", ["Disposition Semantics", "Replacement And Withdrawal"]],
      ["compile", "temporal-and-evidence.md", ["Temporal Priors", "Evidence Boundary Repair"]],
      ["compile", "leakage-and-ownership.md", ["Context-only Leakage", "Repair Routes"]],
      ["compile", "scope-review-and-omit.md", ["Scope Review", "No-write Discipline"]],
      ["compile", "user-confirmation.md", ["User Confirmation Paths", "What Counts As Confirmation"]],
      ["compile", "close-gate.md", ["knowledge/structure.yaml", "verify"]],
    ] as const;

    expect((await readdir(join(WORKFLOW_ROOT, "resources", "semantic", "align"))).sort()).toEqual(
      resources.filter(([scope]) => scope === "align").map(([, file]) => file).sort(),
    );
    expect((await readdir(join(WORKFLOW_ROOT, "resources", "semantic", "compile"))).sort()).toEqual(
      [
        ...resources.filter(([scope]) => scope === "compile").map(([, file]) => file),
        "index.md",
      ].sort(),
    );

    let totalBytes = 0;
    for (const [scope, file, snippets] of resources) {
      const body = await read(WORKFLOW_ROOT, "resources", "semantic", scope, file);
      totalBytes += Buffer.byteLength(body, "utf8");
      expect(body, `${scope}/${file}`).toMatch(/^---\n/u);
      expect(body, `${scope}/${file}`).toContain(`id: context.semantic.${scope}.`);
      expect(body, `${scope}/${file}`).toContain("kind: procedure");
      expect(Buffer.byteLength(body, "utf8"), `${scope}/${file} must remain a full procedure, not a summary`)
        .toBeGreaterThan(2_000);
      for (const snippet of snippets) {
        expect(body, `${scope}/${file}:${snippet}`).toContain(snippet);
      }
    }
    expect(totalBytes, "semantic procedures must not be collapsed into short hints").toBeGreaterThan(130_000);

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

  test("workflow graph exposes the complete semantic inventory as progressive context", async () => {
    const graph = await read(WORKFLOW_ROOT, "graphs", "workspace.yaml");
    const compileIndex = await read(
      WORKFLOW_ROOT,
      "resources",
      "semantic",
      "compile",
      "index.md",
    );
    for (const file of [
      "align/structure-planning.md",
      "align/gates.md",
      "align/density-profile.md",
      "align/candidate-resolution.md",
    ]) {
      expect(graph, file).toContain(`resources/semantic/${file}`);
    }
    expect(graph).toContain("resources/semantic/compile/index.md");
    for (const file of [
      "compile/compile-actions.md",
      "compile/action-domain-gates.md",
      "compile/notes.md",
      "compile/refresh-and-update.md",
      "compile/structural-challenges.md",
      "compile/compile-judgment.md",
      "compile/semantic-judgment.md",
      "compile/disposition-semantics.md",
      "compile/temporal-and-evidence.md",
      "compile/leakage-and-ownership.md",
      "compile/scope-review-and-omit.md",
      "compile/user-confirmation.md",
      "compile/close-gate.md",
    ]) {
      expect(compileIndex, file).toContain(file.replace("compile/", ""));
    }
    expect(graph).toContain("resources/procedures/source-capture-detailed.md");

    const rules = await read(PACKAGE_ROOT, "src", "project", "semanticRules.ts");
    expect(rules).toContain("semanticRuleDescriptors");
    expect(rules).toContain('metadata["applies-to"]');
    expect(rules).toContain('source: "context-workflow"');
  });

  test("route-selected SDK manuals remain complete mirrors of the public docs", async () => {
    const manuals = [
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
      expect(body, workflowPath).toBe(sdk);
    }
  });

  test("every authored workflow resource is reachable from the graph", async () => {
    const resourcesRoot = join(WORKFLOW_ROOT, "resources");
    const graph = await read(WORKFLOW_ROOT, "graphs", "workspace.yaml");
    const compileIndex = await read(
      resourcesRoot,
      "semantic",
      "compile",
      "index.md",
    );
    for (const file of await listFiles(resourcesRoot)) {
      const resourcePath = `resources/${relative(resourcesRoot, file)}`;
      const compileFile = relative(
        join(resourcesRoot, "semantic", "compile"),
        file,
      );
      const selectedTransitively = !compileFile.startsWith("..") &&
        compileFile !== "index.md" &&
        compileIndex.includes(`](${compileFile})`);
      expect(
        graph.includes(resourcePath) || selectedTransitively,
        `${resourcePath} is not selected by any route or resource index`,
      ).toBe(true);
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
