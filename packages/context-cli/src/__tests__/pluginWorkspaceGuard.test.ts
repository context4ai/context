import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
const PLUGIN_ROOT = join(REPOSITORY_ROOT, "plugins", "context");
const ENTRY_PATH = join(PLUGIN_ROOT, "skills", "context", "SKILL.md");
const WORKFLOW_ROOT = join(PACKAGE_ROOT, "context-workflow");
const CONTEXT_PACKAGE_ROOT = join(PACKAGE_ROOT, "..", "context");
const CONTEXT_DOCS_ROOT = join(CONTEXT_PACKAGE_ROOT, "docs");
const GENERATED_PLUGIN_ROOT = join(PACKAGE_ROOT, "dist", "plugins");
const RETIRED_CODEX_TOOL_NAME = ["ask", "user", "question"].join("_");
const PRODUCTION_VERSION_PHRASE_PATTERN = /\bcurrent\s+0\.\d+\.\d+\b/u;

async function listMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listMarkdown(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

function frontmatter(text: string): string {
  return /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
}

describe("plugin and workflow workspace guard", () => {
  test("source package metadata does not publish internal development Markdown", async () => {
    const cliPackage = JSON.parse(
      await readFile(join(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as { files?: string[] };
    const sdkPackage = JSON.parse(
      await readFile(join(CONTEXT_PACKAGE_ROOT, "package.json"), "utf8"),
    ) as { files?: string[] };
    for (const packageJson of [cliPackage, sdkPackage]) {
      expect(packageJson.files).toContain("README.md");
      expect(packageJson.files).toContain("README.zh-CN.md");
      expect(packageJson.files).not.toContain("*.md");
    }
    expect(cliPackage.files).not.toContain("plugin");
  });

  test("development docs keep root plugin sources authoritative", async () => {
    const development = await readFile(join(PACKAGE_ROOT, "DEVELOPMENT.md"), "utf8");
    expect(development).toContain("plugins/context/");
    expect(development).toContain("packages/context-cli/dist/plugins/");
    expect(development).toContain("repo-install");
  });

  test("plugin entry documents do not request direct workspace file tools", async () => {
    for (const file of await listMarkdown(PLUGIN_ROOT)) {
      const metadata = frontmatter(await readFile(file, "utf8"));
      expect(metadata, file).not.toMatch(/allowed-tools:.*\b(Read|Write|Glob|Grep)\b/u);
      expect(metadata, file).not.toMatch(/\n\s+-\s+(Read|Write|Glob|Grep)\b/u);
    }
  });

  test("the single public entry is route-led instead of a duplicated state table", async () => {
    const workflow = await readFile(
      ENTRY_PATH,
      "utf8",
    );
    expect(workflow).toContain("context entry");
    expect(workflow).toContain("context status --resource-receipts");
    expect(workflow).toContain("workflow.current");
    expect(workflow).toContain("resources.required");
    expect(workflow).toContain("Execute only `commands` returned by the Route");
    expect(workflow).toContain("run status again");
    expect(workflow).not.toContain("| declared non-extract phase |");
    expect(workflow).not.toContain(RETIRED_CODEX_TOOL_NAME);
  });

  test("managed mode is explicit, current-conversation-only, and bounded", async () => {
    const boundedEntryFiles = [
      ENTRY_PATH,
      join(PACKAGE_ROOT, "src", "project", "workspaceGuidanceTemplates.ts"),
    ];
    for (const file of boundedEntryFiles) {
      const text = await readFile(file, "utf8");
      expect(text, file).toContain("--managed");
      expect(text, file).toMatch(/(?:current|this) conversation|current-conversation/iu);
      expect(text, file).toMatch(/never|only|unless/iu);
    }
    const continuation = await readFile(boundedEntryFiles[0]!, "utf8");
    expect(continuation).toContain("never");
    expect(continuation).toContain("repo sources");
    const review = await readFile(
      join(WORKFLOW_ROOT, "resources", "procedures", "knowledge-review.md"),
      "utf8",
    );
    expect(review).toContain("explicit session-managed authority");
    expect(review).toContain("current\nconversation");
    expect(review).toMatch(/complete\s+current scope atomically/u);
  });

  test("generated workspace guidance stays concise and graph-led", async () => {
    const source = await readFile(
      join(PACKAGE_ROOT, "src", "project", "workspaceGuidanceTemplates.ts"),
      "utf8",
    );
    expect(source).toContain("Treat `workflow.current` as the current-step authority");
    expect(source).toContain("Read every `resources.required` item");
    expect(source).toContain("do not run another status command");
    expect(source).toContain("preserve revision/authority flags exactly");
    expect(source).toContain("Fully managed mode applies only when the user explicitly requests it");
    expect(source).toContain("use `context status --managed --format json` for every status evaluation");
    expect(source).toContain("stop using it when the conversation ends or the user revokes it");
    expect(source).toContain("`execution.target: agent-host`");
    expect(source).not.toContain("Execute safe mechanical `next:` steps");
    const continuation = await readFile(ENTRY_PATH, "utf8");
    expect(continuation).toContain("`execution.target` is `agent-host`");
    expect(continuation).toMatch(/not inside a restricted child\s+sandbox/u);
  });

  test("retired semantic resource trees are absent from Skills and workflow source", async () => {
    const pluginMarkdown = await listMarkdown(PLUGIN_ROOT);
    expect(pluginMarkdown.some((file) => file.includes("internal-procedures"))).toBe(false);
    expect(pluginMarkdown.some((file) => file.endsWith("capture-source.md"))).toBe(false);

    const semantic = await listMarkdown(join(WORKFLOW_ROOT, "resources", "semantic"));
    expect(semantic).toEqual([]);
  });

  test("SDK package templates preserve current OKF root mapping", async () => {
    const template = await readFile(
      join(CONTEXT_PACKAGE_ROOT, "templates", "package-templates", "kb", "skills", "knowledge-query", "SKILL.md"),
      "utf8",
    );
    expect(template).toContain("Query Procedure");
    expect(template).toContain("Package Roots");
    expect(template).toContain("Start from `{{guidesRoot}}/index.md`");
    expect(template).toContain("Start from `{{rulesRoot}}/index.md`");
    expect(template).toContain("context-build-inventory.json");
    expect(template).toContain("Template Author Recommendation");
    expect(template).toContain("edit it before publishing");
    expect(template).not.toContain("C4A");

    const agents = await readFile(
      join(CONTEXT_PACKAGE_ROOT, "templates", "package-templates", "kb", "AGENTS.md"),
      "utf8",
    );
    expect(agents).toContain("`{{wikisRoot}}/` maps from structured `codeindex`, `business`, and `product` knowledge");
    expect(agents).toContain("`{{guidesRoot}}/` maps from `architecture`, `sop`, `faq`, `decision`, and `incident`");
    expect(agents).toContain("`{{rulesRoot}}/` maps from `standards` and `test`");

    const localizedTemplate = await readFile(
      join(CONTEXT_PACKAGE_ROOT, "templates", "package-templates.zh-CN", "kb", "skills", "knowledge-query", "SKILL.md"),
      "utf8",
    );
    expect(localizedTemplate).toContain("## 知识根目录");
    expect(localizedTemplate).toContain("## 模板作者建议");
    expect(localizedTemplate).toContain("正式发布前");
    expect(localizedTemplate).not.toContain("C4A");
  });

  test("agent-facing docs avoid collection-specific wiki wording and drifting version narratives", async () => {
    const files = [
      ...await listMarkdown(PLUGIN_ROOT),
      ...await listMarkdown(WORKFLOW_ROOT),
      ...await listMarkdown(CONTEXT_DOCS_ROOT),
    ];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(/draft wiki candidates|approved wiki pages?|wiki section/iu);
      expect(text, file).not.toMatch(PRODUCTION_VERSION_PHRASE_PATTERN);
    }
  });

  test("generated public skills remain thin after plugin build", async () => {
    const generated = [
      join(GENERATED_PLUGIN_ROOT, "codex", "skills"),
      join(GENERATED_PLUGIN_ROOT, "skills"),
    ];
    for (const root of generated) {
      const files = await listMarkdown(root);
      for (const file of files) {
        const text = await readFile(file, "utf8");
        expect(text, file).not.toContain("structure-planning/references");
        expect(text, file).not.toContain("compile-actions/references");
        expect(text, file).not.toContain("capture-source.md");
        expect(text, file).not.toContain("references/internal-procedures");
        expect(text, file).not.toMatch(/`(?:context:)?skill-[a-z-]+`/u);
      }
      for (const entry of ["context"]) {
        const name = entry;
        const body = await readFile(join(root, name, "SKILL.md"), "utf8");
        expect(body, `${root}/${name}`).toContain(
          "context entry",
        );
        expect(body, `${root}/${name}`).toContain("workflow.current");
      }
    }
  });
});
