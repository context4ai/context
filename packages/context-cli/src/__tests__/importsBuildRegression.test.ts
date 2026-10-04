import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { kbPackage } from "@c4a/context";
import { importsFingerprint, importsLinkProjector, importsPages } from "../project/importsPages.js";
import { packageKnowledgeBundle, writeRenderedPackageTemplate, writeSelectedPackageKnowledge } from "../project/packageBuildContent.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { initContextProject } from "../project/workspace.js";
import { markdownReaderLinks } from "../project/markdownLinks.js";
import { invokeCliInDir } from "./projectBuildVerifyV060Helpers.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const parent = resolve(import.meta.dir, "../../../../.tmp/imports-regression");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "workspace-"));
  roots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "imports-fixture", type: "module", context: { language: "en" } }));
  await declaration(root, "https://example.org/guide");
  return root;
}
async function declaration(root: string, url: string) {
  await writeFile(join(root, "imports.yaml"), YAML.stringify({ protocol: "context.imports/v1", imports: {
    guide: { url, title: "Guide", description: "External documentation", path: "docs", version: "v1", format: "web" },
  } }));
}
async function buildFixture(importsPage: boolean) {
  const root = await fixture();
  // Initialization preserves an existing package.json; start from no package
  // so this fixture receives the actual Context project/entry declaration.
  await rm(join(root, "package.json"));
  await initContextProject({ cwd: root, projectDir: ".", dev: true, allowNonempty: true });
  await mkdir(join(root, "template/wikis"), { recursive: true });
  await mkdir(join(root, "template/skills/query"), { recursive: true });
  await writeFile(join(root, "template/wikis/index.md"), "# Reference\n\n{{knowledgeGroupsMarkdown}}\n");
  await writeFile(join(root, "template/skills/query/SKILL.md"), "---\nname: query\ndescription: Read package documentation.\n---\n\nRead wikis/index.md.\n");
  await writeFile(join(root, "src/index.ts"), `import { defineProject, kbPackage } from "@c4a/context";
export default defineProject({ sources: [], phases: [], packages: [kbPackage({
  name: "sample", template: { path: "template" }, importsPage: ${importsPage},
})] });\n`);
  return root;
}

test("bundle variables and individual pages resolve the same declared imports", async () => {
  const root = await fixture();
  const pkg = kbPackage({ name: "sample", template: { path: "template" } });
  const selected = [{ relPath: "wikis/guide.md", absPath: "", content: "# Guide\n\n[External](context:import/guide)\n" }];
  for (const url of ["https://example.org/guide", "https://example.org/revised"]) {
    await declaration(root, url);
    const bundle = await packageKnowledgeBundle(root, pkg, selected);
    await writeRenderedPackageTemplate({ projectRoot: root, pkg,
      files: [{ relPath: "wikis/index.md", absPath: "", content: "{{{knowledge}}}\n\n{{{approvedKnowledge}}}" }],
      bundle, knowledgeTimestamp: "", selected, buildInventory: {}, knowledgeStructure: null });
    await writeSelectedPackageKnowledge({ projectRoot: root, pkg, files: selected });
    const template = await readFile(join(root, pkg.outDir, "wikis/index.md"), "utf8");
    const article = await readFile(join(root, pkg.outDir, "wikis/guide.md"), "utf8");
    expect(template).not.toContain("context:import/");
    expect(template.split(url)).toHaveLength(3);
    expect(article).toContain(url);
  }
});

test("import projection preserves image labels, titles and reference definitions", async () => {
  const root = await fixture();
  const project = await importsLinkProjector(root);
  for (const markdown of [
    '[![Logo](logo.png "Logo")](context:import/guide "Read guide")',
    '![Guide](context:import/guide "Preview")',
    '[Guide][entry]\n\n[entry]: <context:import/guide> "Read guide"',
  ]) {
    expect(await project(markdown)).toBe(markdown.replace("context:import/guide", "https://example.org/guide"));
  }
  const unused = "[Guide](context:import/guide)\n\n[unused]: context:import/missing\n";
  expect(await project(unused)).toBe("[Guide](https://example.org/guide)\n\n");
});

test("external table URLs preserve query semantics without creating extra cells", async () => {
  const root = await fixture();
  const url = "https://example.org/guide?q=a|b&copy;=literal&next=(intro)#details";
  await declaration(root, url);
  const pkg = kbPackage({ name: "sample", template: { path: "template" }, importsPage: true });
  const [page] = await importsPages(root, pkg);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(page!.content);
  const table = tree.children.find(node => node.type === "table");
  if (table?.type !== "table") throw new Error("Missing rendered table");
  const row = table.children[1]!;
  expect(row.children).toHaveLength(5);
  const link = row.children[0]!.children[0];
  if (link?.type !== "link") throw new Error("Missing external link");
  expect(decodeURI(link.url)).toBe(url);
  expect(await readFile(join(root, "imports.yaml"), "utf8")).toContain(url);
});

test("raw Markdown keeps query separators copyable for Agents", async () => {
  const root = await fixture();
  const url = "https://example.org/guide?a=1&b=2";
  await declaration(root, url);
  const project = await importsLinkProjector(root);
  expect(await project("[Guide](context:import/guide)")).toBe(`[Guide](${url})`);
  const [page] = await importsPages(root, kbPackage({ name: "sample", template: { path: "template" }, importsPage: true }));
  expect(page!.content).toContain(`(<${url}>)`);
});

test("incremental builds refresh directory and navigation when language changes", async () => {
  const root = await buildFixture(true);
  expect((await buildProjectPackages(root)).packages[0]?.state).toBe("created");
  expect((await buildProjectPackages(root)).packages[0]?.state).toBe("unchanged");
  const packagePath = join(root, "package.json");
  const metadata = JSON.parse(await readFile(packagePath, "utf8"));
  metadata.context = { ...metadata.context, language: "zh-CN" };
  await writeFile(packagePath, JSON.stringify(metadata));
  expect((await buildProjectPackages(root)).packages[0]?.state).toBe("updated");
  expect(await readFile(join(root, "dist/sample/wikis/imports.md"), "utf8")).toContain("外部内容");
  expect(await readFile(join(root, "dist/sample/wikis/index.md"), "utf8")).toContain("外部内容");
  expect((await buildProjectPackages(root)).packages[0]?.state).toBe("unchanged");
}, 60000);

test("invalid imports are skipped with persistent build warnings and recover after repair", async () => {
  const root = await buildFixture(false);
  await rm(join(root, "imports.yaml"));
  await mkdir(join(root, "imports.yaml"));
  expect((await buildProjectPackages(root)).packages[0]?.state).toBe("created");
  const pkg = kbPackage({ name: "sample", template: { path: "template" } });
  expect(await importsFingerprint(root, pkg, ["`[Example](context:import/guide)`"])).toBeNull();
  expect(await importsFingerprint(root, pkg, ["[Guide](context:import/guide)"])).toMatchObject({ problem: expect.stringContaining("regular file") });
  expect(await importsPages(root, { ...pkg, importsPage: true })).toEqual([]);
  const entryPath = join(root, "src/index.ts");
  await writeFile(entryPath, (await readFile(entryPath, "utf8")).replace("importsPage: false", "importsPage: true"));
  const skipped = (await buildProjectPackages(root)).packages[0]!;
  expect(skipped.linkWarnings).toContainEqual(expect.objectContaining({ code: "package-imports-unavailable", path: "imports.yaml" }));
  await expect(readFile(join(root, "dist/sample/wikis/imports.md"))).rejects.toMatchObject({ code: "ENOENT" });
  const repeated = (await buildProjectPackages(root)).packages[0]!;
  expect(repeated.state).toBe("unchanged");
  expect(repeated.linkWarnings).toEqual(skipped.linkWarnings);
  const cli = await invokeCliInDir(root, ["build", "--format", "json"]);
  expect(cli.status).toBe(0);
  expect(JSON.parse(cli.stdout).packages[0].linkWarnings).toEqual(skipped.linkWarnings);
  const text = await invokeCliInDir(root, ["build"]);
  expect(text.status).toBe(0);
  expect(text.stdout).toContain("Correct imports.yaml");
  await rm(join(root, "imports.yaml"), { recursive: true });
  await declaration(root, "https://example.org/repaired");
  expect((await buildProjectPackages(root)).packages[0]?.linkWarnings).toEqual([]);
  expect(await readFile(join(root, "dist/sample/wikis/imports.md"), "utf8")).toContain("https://example.org/repaired");
  await writeFile(join(root, "imports.yaml"), "imports: [broken\n");
  expect((await buildProjectPackages(root)).packages[0]?.linkWarnings).toContainEqual(expect.objectContaining({ code: "package-imports-unavailable" }));
  await expect(readFile(join(root, "dist/sample/wikis/imports.md"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(root, "dist/sample/wikis/index.md"), "utf8")).not.toContain("imports.md");
}, 60000);

test("unresolved inline, nested and reference imports become text without changing approved input", async () => {
  const root = await fixture();
  const pkg = kbPackage({ name: "sample", template: { path: "template" } });
  const content = '[Unknown](context:import/unknown)\n\n[![Logo](context:import/image)](context:import/outer)\n\n[Reference][missing]\n\n[missing]: context:import/unknown\n\n[Known](context:import/guide)\n';
  const selected = [{ relPath: "wikis/guide.md", absPath: "", content }];
  const bundle = await packageKnowledgeBundle(root, pkg, selected);
  const output = await writeSelectedPackageKnowledge({ projectRoot: root, pkg, files: selected });
  for (const markdown of [bundle, await readFile(join(root, pkg.outDir, "wikis/guide.md"), "utf8")]) {
    expect(markdown).toContain("Unknown (unresolved import:");
    expect(markdown).toContain("Logo (unresolved import:");
    expect(markdownReaderLinks(markdown).map(link => link.target)).toEqual(["https://example.org/guide"]);
    expect(markdown).not.toContain("context:import/");
  }
  expect(output.linkWarnings).toHaveLength(3);
  expect(output.linkWarnings.every(warning => warning.code === "package-import-unresolved")).toBe(true);
  expect(selected[0]!.content).toBe(content);
});
