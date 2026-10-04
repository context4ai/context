import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { importsRegistrySchema, kbPackage } from "@c4a/context";
import { readImportsRegistry } from "../project/importsRegistry.js";
import { importsPages, importsLinkProjector, importsFingerprint } from "../project/importsPages.js";
import { repoContentNavigation, writeRepoContentPages } from "../project/repoContentPages.js";
import { writeRenderedPackageTemplate } from "../project/packageBuildContent.js";
import { writePackageSite } from "../project/packageSite.js";
import { initContextProject, formatProjectInitResult } from "../project/workspace.js";
import { repoContentGit } from "../project/repoContentGit.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const parent = resolve(import.meta.dir, "../../../../.tmp/imports-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "workspace-")); roots.push(root);
  await repoContentGit(root, ["init", "-b", "main"]);
  await writeFile(join(root, "package.json"), JSON.stringify({ context: { language: "zh-CN" } }));
  await writeFile(join(root, "imports.yaml"), YAML.stringify({ protocol: "context.imports/v1", imports: {
    tool: { kind: "plugin", url: "https://unavailable.example.org/plugin", version: "preview" },
    guide: { kind: "knowledge", url: "https://example.org/repo/tree/v1/docs", path: "docs", description: "<script>x</script>|[bad](javascript:x)" },
    extra: { kind: "custom", url: "https://example.org/custom" },
  } }));
  return root;
}

test("imports are provider-neutral declarations with no installation commands", () => {
  expect(importsRegistrySchema.parse({ protocol: "context.imports/v1", imports: { a: { url: "https://example.org", kind: "new-kind" } } }).imports.a?.kind).toBe("new-kind");
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "https://user:secret@example.org", "https://example.org/<bad>"]) {
    expect(importsRegistrySchema.safeParse({ protocol: "context.imports/v1", imports: { a: { url } } }).success).toBe(false);
  }
});

test("links preserve the declared entrance and do not guess provider routes", async () => {
  const root = await fixture();
  const project = await importsLinkProjector(root);
  expect(await project("[Guide](context:import/guide)")).toBe("[Guide](https://example.org/repo/tree/v1/docs)");
  expect(await project("`[example](context:import/missing)`")).toBe("`[example](context:import/missing)`");
  expect(await project("[Missing](context:import/missing)")).toBe("Missing (unresolved import: missing)");
  expect(await project("[Suffix](context:import/guide/child)")).toBe("Suffix (unresolved import: guide/child)");
});

test("optional offline directory is escaped, ordered and included in navigation", async () => {
  const root = await fixture();
  const pkg = kbPackage({ name: "kb", template: { path: "template" }, importsPage: true });
  expect(await importsPages(root, kbPackage({ name: "disabled", template: { path: "template" } }))).toEqual([]);
  const pages = await importsPages(root, pkg);
  const text = pages[0]!.content;
  expect(text.indexOf("## 知识")).toBeLessThan(text.indexOf("## 插件"));
  expect(text).not.toContain("<script>");
  expect(text).toContain("\\[bad\\]");
  expect(text).toContain("preview");
  expect(repoContentNavigation(pages)[0]?.relPath).toBe("wikis/imports.md");
  await writeRepoContentPages(root, pkg, pages);
  await expect(writeRepoContentPages(root, pkg, pages)).rejects.toThrow("collides");
  const before = await importsFingerprint(root, pkg);
  await writeFile(join(root, "imports.yaml"), "protocol: context.imports/v1\nimports: {}\n");
  expect(await importsFingerprint(root, pkg)).not.toEqual(before);
});

test("invalid declarations are local diagnostics, not mandatory reads for unrelated text", async () => {
  const root = await fixture();
  await writeFile(join(root, "imports.yaml"), "imports: [bad\n");
  await expect(readImportsRegistry(root)).rejects.toThrow("Invalid imports declaration");
  expect(await (await importsLinkProjector(root))("Ordinary article")).toBe("Ordinary article");
  await rm(join(root, "imports.yaml"));
  expect(await readImportsRegistry(root)).toBeUndefined();
  await writeFile(join(root, "other.yaml"), "protocol: context.imports/v1\nimports: {}\n");
  await symlink("other.yaml", join(root, "imports.yaml"));
  await expect(readImportsRegistry(root)).rejects.toThrow("regular file");
});

test("initialization enables only present entrances and preserves existing configuration", async () => {
  const root = await fixture();
  await rm(join(root, "package.json"));
  await initContextProject({ cwd: root, projectDir: ".", dev: true, allowNonempty: true });
  const path = join(root, "src/index.ts");
  const entry = await readFile(path, "utf8");
  expect(entry).toContain("importsPage: true");
  expect(entry).not.toContain("repoContentPage: true");
  await writeFile(path, "// retained user configuration\n");
  await initContextProject({ cwd: root, projectDir: ".", dev: true, allowNonempty: true });
  expect(await readFile(path, "utf8")).toBe("// retained user configuration\n");
});

test.each(["malformed", "invalid-schema", "symlink"])("initialization preserves %s imports and completes with an actionable warning", async kind => {
  const root = await fixture();
  await rm(join(root, "package.json"));
  const path = join(root, "imports.yaml");
  const original = kind === "malformed" ? "imports: [broken\n" : "protocol: unsupported\nimports: {}\n";
  await writeFile(path, original);
  if (kind === "symlink") {
    await rm(path);
    await writeFile(join(root, "other.yaml"), original);
    await symlink("other.yaml", path);
  }
  const result = await initContextProject({ cwd: root, projectDir: ".", dev: true, allowNonempty: true });
  expect(result.warnings).toEqual([expect.objectContaining({ code: "imports-unavailable", path: "imports.yaml" })]);
  expect(formatProjectInitResult(result)).toContain("Correct imports.yaml");
  expect(await readFile(path, "utf8")).toBe(original);
  const entry = await readFile(join(root, "src/index.ts"), "utf8");
  expect(entry).toContain("defineProject");
  expect(entry).not.toContain("importsPage");
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("Context");
  expect(await readFile(join(root, "sources/repo/index.yaml"), "utf8")).toContain("sources:");
  await initContextProject({ cwd: root, projectDir: ".", dev: true, allowNonempty: true });
  expect(await readFile(join(root, "src/index.ts"), "utf8")).toBe(entry);
});

test("external directory website exposure is independent of package inclusion", async () => {
  const root = await fixture();
  for (const exposed of [false, true]) {
    const pkg = kbPackage({ name: exposed ? "public" : "internal", site: {},
      template: { path: "template" }, importsPage: exposed ? { site: true } : true });
    const pages = await importsPages(root, pkg);
    await writeRenderedPackageTemplate({ projectRoot: root, pkg,
      files: [{ relPath: "wikis/index.md", absPath: "", content: "# Reference\n\n{{knowledgeGroupsMarkdown}}\n" }],
      bundle: "", knowledgeTimestamp: "", selected: [], navigationFiles: repoContentNavigation(pages), buildInventory: {}, knowledgeStructure: null });
    await writeRepoContentPages(root, pkg, pages);
    expect(await readFile(join(root, pkg.outDir, "wikis/index.md"), "utf8")).toContain("imports.md");
    await writePackageSite({ projectRoot: root, pkg, selected: [] });
    const map = JSON.parse(await readFile(join(root, pkg.outDir, "context-site-map.json"), "utf8"));
    expect(map.pages.some((page: { package_path: string }) => page.package_path === "wikis/imports.md")).toBe(exposed);
  }
}, 120000);
