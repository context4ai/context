import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { createCliProgram } from "../cli.js";
import { findContextProjectRoot, initContextProject, loadContextProjectModule } from "../project/workspace.js";
import { addRepoSource } from "../project/repoSources.js";
import {
  REPO_NAMESPACE,
  initGitRepo,
  makeTmp,
  runCliInDir,
  writeSampleLibProjectEntry,
} from "./projectV060Helpers.js";

describe("0.6.0 project init and source ensure", () => {
  test("context init creates a project-local skeleton in the default context directory", async () => {
    const root = makeTmp();
    try {
      const stdout = await runCliInDir(root, ["init"]);
      const project = join(root, "context");

      expect(stdout).toContain("initialized \"context\"");
      for (const rel of ["src", "sources", "knowledge", "dist"]) {
        expect(existsSync(join(project, rel))).toBe(true);
      }
      expect(existsSync(join(project, "unapproved"))).toBe(false);
      expect(existsSync(join(project, "AGENTS.md"))).toBe(true);
      const agents = await readFile(join(project, "AGENTS.md"), "utf8");
      expect(agents).toContain("## Operating Contract");
      expect(agents).toContain("## Safety Boundaries");
      expect(agents).toContain("## Standard Manual");
      expect(agents).toContain("Treat `workflow.current` as the current-step authority");
      expect(agents).toContain("Read every `resources.required` item");
      expect(agents).toContain("do not run another status command");
      expect(agents).toContain("preserve revision/authority flags exactly");
      expect(agents).toContain("`.tmp/agent-payloads/`");
      expect(agents).toContain("Avoid inventing top-level scratch directories such as `inputs/`");
      expect(agents).toContain("Context completion proves knowledge-workflow state, not Git commit safety");
      expect(agents).toContain("stage only explicit paths");
      expect(agents).toContain(
        "Fully managed mode applies only when the user explicitly requests it in the current conversation",
      );
      expect(agents).toContain("`execution.target: agent-host`");
      expect(agents).toContain("Read only the manuals and schemas selected by `workflow.current.resources`");
      expect(agents).not.toContain("Normal codegraph extraction sends the first run");
      expect(agents).not.toContain("## State Boundaries");
      expect(agents).not.toContain("parent monorepo/subspace");
      expect(agents).not.toContain("migrate-codegraph-refs");
      expect(agents).not.toContain("src-N#symbol");
      expect(existsSync(join(project, "package.json"))).toBe(true);
      const readme = await readFile(join(project, "README.md"), "utf8");
      expect(readme).toContain('TMPDIR="$PWD/.tmp/install" bun install');
      expect(readme).toContain("`.tmp/install/`");
      const gitignore = await readFile(join(project, ".gitignore"), "utf8");
      expect(gitignore).toContain(".tmp/");
      expect(gitignore).toContain("node_modules/");
      expect(gitignore).toContain("dist/");
      expect(gitignore).toContain("sources/repo/*");
      expect(gitignore).toContain("!sources/repo/index.yaml");
      expect(gitignore).toContain("sources/**/.tmp/");
      expect(gitignore).toContain("sources/**/.cache/");
      expect(existsSync(join(project, "src", "index.ts"))).toBe(true);
      expect(existsSync(join(project, "src", "package-templates", "kb", "wikis", "index.md"))).toBe(true);
      expect(existsSync(join(project, "src", "package-templates", "kb", "skills", "knowledge-query", "SKILL.md"))).toBe(true);
      expect(existsSync(join(
        project,
        "src",
        "package-templates",
        "kb",
        "skills",
        "knowledge-query",
        "scripts",
        "search.mjs",
      ))).toBe(true);
      expect(existsSync(join(project, "src", "package-templates", "kb", ".context-template.json"))).toBe(true);
      expect(existsSync(join(project, "src", "package-templates", "llms", ".context-template.json"))).toBe(true);
      const kbIndexTemplate = await readFile(join(project, "src", "package-templates", "kb", "wikis", "index.md"), "utf8");
      expect(kbIndexTemplate).toContain("type: Knowledge Bundle");
      expect(kbIndexTemplate).toContain("package: \"{{packageName}}\"");
      expect(kbIndexTemplate).toContain("package_kind: \"{{packageKind}}\"");
      expect(kbIndexTemplate).toContain("knowledge_count: {{knowledgeCount}}");
      expect(kbIndexTemplate).not.toContain("\ncontext:\n");
      const knowledgeQueryTemplate = await readFile(
        join(project, "src", "package-templates", "kb", "skills", "knowledge-query", "SKILL.md"),
        "utf8",
      );
      expect(knowledgeQueryTemplate).toContain("Answer from the approved knowledge");
      expect(knowledgeQueryTemplate).toContain("Query Procedure");
      expect(knowledgeQueryTemplate).toContain("Package Roots");
      expect(knowledgeQueryTemplate).toContain("Evidence Contract");
      expect(knowledgeQueryTemplate).toContain("Route By Intent");
      expect(knowledgeQueryTemplate).toContain("Search Fallback");
      expect(knowledgeQueryTemplate).toContain("context:section");
      expect(knowledgeQueryTemplate).toContain("Treat every hit as a lead");
      expect(knowledgeQueryTemplate).toContain("Do not infer a relationship from page co-occurrence");
      expect(knowledgeQueryTemplate).toContain("Gap: this package does not contain evidence");
      expect(knowledgeQueryTemplate).toContain("Template Author Recommendation");
      expect(knowledgeQueryTemplate).not.toContain("C4A");
      expect(knowledgeQueryTemplate).toContain("Search only when indexes and page structure");
      expect(existsSync(join(project, "sources", "repo", "index.yaml"))).toBe(true);
      expect(existsSync(join(project, ".context"))).toBe(false);
      const pkg = JSON.parse(await readFile(join(project, "package.json"), "utf8")) as {
        context?: { project?: boolean; entry?: string; language?: string };
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const cliPkg = JSON.parse(await readFile(join(import.meta.dir, "..", "..", "package.json"), "utf8")) as {
        version: string;
      };
      expect(pkg.context).toEqual({ project: true, entry: "src/index.ts", language: "en" });
      expect(pkg.dependencies?.["@c4a/context"]).toBe(cliPkg.version);
      expect(pkg.devDependencies?.typescript).toBe("latest");
      expect(pkg.devDependencies?.["@c4a/context-cli"]).toBeUndefined();
      const entry = await readFile(join(project, "src", "index.ts"), "utf8");
      expect(entry).toContain("defineProject");
      expect(entry).toContain("phases: []");
      expect(entry).toContain("context source add ...");
      expect(findContextProjectRoot(join(project, "src"))?.projectRoot).toBe(project);
      rmSync(join(project, "knowledge"), { recursive: true, force: true });
      rmSync(join(project, "dist"), { recursive: true, force: true });
      expect(findContextProjectRoot(join(project, "src"))?.projectRoot).toBe(project);
      rmSync(join(project, "sources", "repo", "index.yaml"), { force: true });
      rmSync(join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), { force: true });
      expect(findContextProjectRoot(join(project, "src"))?.projectRoot).toBe(project);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("context init uses an explicit language for workspace and package starter templates", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({
        cwd: root,
        projectDir: "localized",
        language: "zh-CN",
        dev: true,
      });
      const pkg = JSON.parse(await readFile(join(result.projectRoot, "package.json"), "utf8")) as {
        context: { language: string };
      };
      const agents = await readFile(join(result.projectRoot, "AGENTS.md"), "utf8");
      const readme = await readFile(join(result.projectRoot, "README.md"), "utf8");
      const skill = await readFile(join(
        result.projectRoot,
        "src",
        "package-templates",
        "kb",
        "skills",
        "knowledge-query",
        "SKILL.md",
      ), "utf8");
      expect(result.language).toBe("zh-CN");
      expect(pkg.context.language).toBe("zh-CN");
      expect(agents).toContain("## 执行契约");
      expect(agents).toContain("全托管只在用户于当前会话明确提出时生效");
      expect(agents).toContain("`execution.target: agent-host`");
      expect(agents).toContain("Context 完成只证明知识工作流状态，不证明 Git 提交范围安全");
      expect(readme).toContain("这是一个项目内的 Context 工作区");
      expect(readme).toContain('TMPDIR="$PWD/.tmp/install" bun install');
      expect(readme).toContain("`.tmp/install/`");
      expect(skill).toContain("# 知识查询");
      expect(skill).toContain("## 模板作者建议");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("context init . supports name override without project-local adapters", async () => {
    const project = makeTmp();
    try {
      const stdout = await runCliInDir(project, ["init", ".", "--name", "sample-kb"]);

      expect(stdout).toContain("initialized \"sample-kb\"");
      expect(existsSync(join(project, ".context"))).toBe(false);
      expect(existsSync(join(project, ".claude"))).toBe(false);
      expect(existsSync(join(project, ".codex"))).toBe(false);
      const readme = await readFile(join(project, "README.md"), "utf8");
      expect(readme).toContain("context plugin install");
      expect(readme).toContain("context status");
      const pkg = JSON.parse(await readFile(join(project, "package.json"), "utf8")) as {
        name: string;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      expect(pkg.name).toBe("sample-kb");
      expect(pkg.dependencies["@c4a/context"]).toBeTruthy();
      expect(pkg.devDependencies["@c4a/context-cli"]).toBeUndefined();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("context init requires explicit confirmation before adding a workspace to a non-empty directory", async () => {
    const project = makeTmp();
    try {
      const existingPath = join(project, "existing.txt");
      writeFileSync(existingPath, "preserve\n", "utf8");

      await expect(initContextProject({
        cwd: project,
        projectDir: ".",
        dev: true,
      })).rejects.toMatchObject({
        detail: {
          reason_code: "init-target-nonempty",
          path: project,
          entries_count: 1,
          entries_preview: ["existing.txt"],
          next_action: {
            kind: "confirm_nonempty_init",
            command: "context init . --dev --allow-nonempty",
            reason_code: "init-target-nonempty-confirmation-required",
          },
        },
      });
      expect(existsSync(join(project, "package.json"))).toBe(false);
      expect(existsSync(join(project, "src"))).toBe(false);

      const result = await initContextProject({
        cwd: project,
        projectDir: ".",
        dev: true,
        allowNonempty: true,
      });
      expect(result.projectRoot).toBe(project);
      expect(readFileSync(existingPath, "utf8")).toBe("preserve\n");
      expect(existsSync(join(project, "package.json"))).toBe(true);
      expect(existsSync(join(project, "src", "index.ts"))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("context init --dev uses the local SDK package path", async () => {
    const project = makeTmp();
    try {
      await runCliInDir(project, ["init", ".", "--name", "sample-kb", "--dev"]);

      const pkg = JSON.parse(await readFile(join(project, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
      };
      const dependency = pkg.dependencies["@c4a/context"];
      expect(dependency).toBeDefined();
      if (dependency === undefined) throw new Error("@c4a/context dependency missing");
      expect(dependency).toStartWith("file:");
      expect(existsSync(join(dependency.slice("file:".length), "package.json"))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("project module loader reads src/index.ts and init itself does not load it", async () => {
    const project = makeTmp();
    const marker = join(project, "loaded.txt");
    try {
      await runCliInDir(project, ["init", "."]);
      await writeFile(join(project, "src", "index.ts"), [
        "import { writeFileSync } from 'node:fs';",
        "import { projectName } from './helper';",
        `writeFileSync(${JSON.stringify(marker)}, projectName);`,
        "export default { kind: 'context.project', project: { sources: [], phases: [], packages: [] } };",
        "",
      ].join("\n"));
      await writeFile(join(project, "src", "helper.ts"), "export const projectName = 'loader-ok';\n");

      expect(existsSync(marker)).toBe(false);
      const loaded = await loadContextProjectModule(project);
      expect(loaded.kind).toBe("context.project");
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, "utf8")).toBe("loader-ok");
      expect(existsSync(join(project, ".tmp", "context-runtime"))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("project run lists and dry-runs declared init phases", async () => {
    const project = makeTmp();
    try {
      await runCliInDir(project, ["init", "."]);
      await writeSampleLibProjectEntry(project);

      const list = await runCliInDir(project, ["run", "--list"]);
      expect(list).toContain("extract:20260712/sample-lib:codegraph");
      expect(list).toContain("review:codegraph:validity");

      const plan = JSON.parse(await runCliInDir(project, [
        "run",
        "extract:20260712/sample-lib:codegraph",
        "--dry-run",
        "--format",
        "json",
      ])) as {
        phase: { id: string; kind: string; reads: string[]; writes: string[] };
        dryRun: boolean;
      };
      expect(plan.dryRun).toBe(true);
      expect(plan.phase).toMatchObject({
        id: "extract:20260712/sample-lib:codegraph",
        kind: "phase.extract.ts",
      });
      expect(plan.phase.reads).toContain("source:repo:20260712/sample-lib");
      expect(plan.phase.writes).toContain("lifecycle:candidates:codegraph:draft");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("project extract fails clearly when the repo registry is empty", async () => {
    const project = makeTmp();
    try {
      await runCliInDir(project, ["init", "."]);
      await writeSampleLibProjectEntry(project);

      await expect(runCliInDir(project, ["run", "extract:20260712/sample-lib:codegraph"])).rejects.toThrow(
        "repo source is not registered",
      );
      expect(existsSync(join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("project status reports a broken src entry without hiding source diagnostics", async () => {
    const project = makeTmp();
    try {
      await runCliInDir(project, ["init", "."]);
      await writeFile(join(project, "src", "index.ts"), "export default ;\n", "utf8");

      const status = await runCliInDir(project, ["status"]);
      expect(status).toContain("state: route.workspace.project-entry-invalid");
      expect(status).toContain("sources: 0/0 ready");
      expect(status).toContain("diagnostic project: project entry src/index.ts failed to load:");
      expect(status).toContain("next: Repair the Context project entry before continuing: update src/index.ts");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("project status rejects duplicate phase ids before routing", async () => {
    const project = makeTmp();
    try {
      await runCliInDir(project, ["init", "."]);
      await writeFile(join(project, "src", "index.ts"), [
        'import { customPhase, defineProject } from "@c4a/context";',
        'const first = customPhase("duplicate", async () => ({ outputs: [] }));',
        'const second = customPhase("duplicate", async () => ({ outputs: [] }));',
        "export default defineProject({ sources: [], phases: [first, second], packages: [] });",
        "",
      ].join("\n"), "utf8");

      const status = await runCliInDir(project, ["status"]);
      expect(status).toContain("state: route.workspace.project-entry-invalid");
      expect(status).toContain('Duplicate Context phase id "duplicate"');
      expect(status).toContain("phases[0] (phase.custom) conflicts with phases[1] (phase.custom)");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("project source commands do not fall back to legacy workspace source models", async () => {
    const root = makeTmp();
    try {
      const sourceCommand = createCliProgram().commands.find((command) => command.name() === "source");
      expect(sourceCommand?.commands.map((command) => command.name())).not.toContain("resolve-ref");

      await expect(runCliInDir(root, ["source", "list"])).rejects.toThrow("source list requires a context project");
      await expect(runCliInDir(root, ["source", "get", "sample-lib"])).rejects.toThrow("source get requires a context project");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("source add repo writes registry, materializes a symlink, and status recommends extraction", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initGitRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeSampleLibProjectEntry(project);

      const addResult = await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      });

      expect(addResult.source.name).toBe("20260712/sample-lib");
      const registry = YAML.parse(await readFile(join(project, "sources", "repo", "index.yaml"), "utf8")) as {
        sources: Array<{ name: string; modules: Array<{ name: string; local: string; git: { remote: string; ref: string } }> }>;
      };
      expect(registry.sources[0]).toMatchObject({
        name: REPO_NAMESPACE,
        modules: [{
          name: "sample-lib",
          local: "../sample-lib",
          git: {
            remote: "https://git.example.com/sample-lib.git",
            ref: head,
          },
        }],
      });
      const sourceList = JSON.parse(await runCliInDir(project, ["source", "list", "--format", "json"])) as Array<{
        id: string;
        type: string;
        ref: string;
      }>;
      expect(sourceList).toEqual([expect.objectContaining({
        id: "20260712/sample-lib",
        type: "repo",
        ref: head,
      })]);
      const sourceGet = JSON.parse(await runCliInDir(project, ["source", "get", "20260712/sample-lib", "--format", "json"])) as {
        name: string;
        remote: string;
      };
      expect(sourceGet).toMatchObject({
        name: "20260712/sample-lib",
        remote: "https://git.example.com/sample-lib.git",
      });
      const link = join(project, "sources", "repo", REPO_NAMESPACE, "sample-lib");
      expect(lstatSync(link).isSymbolicLink()).toBe(true);

      const status = await runCliInDir(project, ["status"]);
      expect(status).toContain("state: route.extract.pending-target");
      expect(status).toContain("--workflow-revision");
      expect(status).toContain("run extract:20260712/sample-lib:codegraph --format json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});
