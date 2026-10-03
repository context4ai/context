import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { execFileSync, spawnSync } from "node:child_process";
import { articleSourceRegionDigest, kbPackage, repoContentRegistrySchema, repoContentScopeMatches } from "@c4a/context";
import { repoContentGit, repoContentRealPath } from "../project/repoContentGit.js";
import { ensureRepoContentLinks, inspectRepoContentLinks, repoContentLinksNeedRepair, type RepoContentLinkResult } from "../project/repoContentLinks.js";
import { readRepoContentRegistry } from "../project/repoContentRegistry.js";
import { repoContentImpactReader, repoContentReferenceReader } from "../project/repoContentEvidence.js";
import { repoContentPages, repoContentLinkProjector, repoContentNavigation, writeRepoContentPages } from "../project/repoContentPages.js";
import { packageTemplateVars } from "../project/packageBuildContent.js";
import { initContextProject } from "../project/workspace.js";
import { beginKnowledgeUpdate, completeKnowledgeUpdate, readKnowledgeUpdate } from "../project/knowledgeUpdate.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(entries: Record<string, unknown> = { docs: { kind: "docs", path: "docs" } }) {
  const temporary = resolve(import.meta.dir, "../../../../.tmp/v0750/tests");
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(join(temporary, "repo-")); roots.push(root);
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs/guide.md"), "# Guide\nStable contract.\nOther detail.\n");
  await writeFile(join(root, "repo-content.yaml"), YAML.stringify({ protocol: "context.repo-content/v1", entries }));
  await repoContentGit(root, ["init", "-b", "main"]);
  await repoContentGit(root, ["config", "user.email", "test@example.org"]);
  await repoContentGit(root, ["config", "user.name", "Test"]);
  await repoContentGit(root, ["config", "commit.gpgsign", "false"]);
  await repoContentGit(root, ["remote", "add", "origin", "https://example.org/team/project.git"]);
  return root;
}
async function commit(root: string) {
  await repoContentGit(root, ["add", "."]);
  await repoContentGit(root, ["commit", "-m", "fixture"]);
  return (await repoContentGit(root, ["rev-parse", "HEAD"])).trim();
}

describe("repository content", () => {
  test("invalid registration is advisory and preserves existing view links", async () => {
    const root = await fixture();
    await initContextProject({ cwd: root, projectDir: ".", dev: true, allowNonempty: true });
    await ensureRepoContentLinks(root);
    await writeFile(join(root, "repo-content.yaml"), YAML.stringify({ protocol: "context.repo-content/v1", entries: {
      docs: { kind: "docs", path: "docs" }, duplicate: { kind: "docs", path: "docs" },
    } }));
    expect((await inspectRepoContentLinks(root))[0]?.status).toBe("invalid");
    expect((await ensureRepoContentLinks(root))[0]?.status).toBe("invalid");
    expect(await readlink(join(root, "repo-content/docs"))).toBe("../docs");
    const status = JSON.parse(execFileSync("node", [resolve(import.meta.dir, "../../dist/cli.js"), "status", "--format", "json"],
      { cwd: root, encoding: "utf8" }));
    expect(status.repo_content.entries[0].status).toBe("invalid");
    expect(status.repo_content).not.toHaveProperty("repair_command");
    const text = execFileSync("node", [resolve(import.meta.dir, "../../dist/cli.js"), "status"], { cwd: root, encoding: "utf8" });
    expect(text).toContain("repo-content.yaml");
    expect(text).not.toContain("context source ensure repo-content");
  });
  test("repair guidance is limited to repairable view states", async () => {
    const states: RepoContentLinkResult["status"][] = ["ready", "missing", "mismatch", "target-missing", "conflict", "removed", "repaired", "symlinks-disabled", "invalid"];
    for (const status of states) {
      expect(repoContentLinksNeedRepair([{ type: "repo-content", name: "docs", path: "repo-content/docs", status }]))
        .toBe(status === "missing" || status === "mismatch");
    }
    const root = await fixture();
    await initContextProject({ cwd: root, projectDir: ".", dev: true, allowNonempty: true });
    const status = JSON.parse(execFileSync("node", [resolve(import.meta.dir, "../../dist/cli.js"), "status", "--format", "json"], { cwd: root, encoding: "utf8" }));
    expect(status.repo_content.repair_command).toBe("context source ensure repo-content --format json");
    await ensureRepoContentLinks(root);
    await rm(join(root, "repo-content.yaml"));
    await repoContentGit(root, ["config", "core.symlinks", "false"]);
    expect(repoContentLinksNeedRepair(await inspectRepoContentLinks(root))).toBe(false);
  });
  test("invalid registry rejects a real build without replacing previous outputs", async () => {
    const root = await fixture();
    await initContextProject({ cwd: root, projectDir: ".", dev: true, allowNonempty: true });
    await writeFile(join(root, "src/package-templates/kb/wikis/index.md"), "# Project documentation\n\n{{knowledgeGroupsMarkdown}}\n");
    const cli = resolve(import.meta.dir, "../../dist/cli.js");
    execFileSync("node", [cli, "build", "--format", "json"], { cwd: root, encoding: "utf8" });
    async function snapshot() {
      const base = join(root, "dist");
      const paths = (await readdir(base, { recursive: true, withFileTypes: true })).filter(item => item.isFile());
      return Promise.all(paths.map(item => join(item.parentPath, item.name)).sort().map(async path => {
        return [path, (await readFile(path)).toString("base64")];
      }));
    }
    const previous = await snapshot();
    expect(previous.length).toBeGreaterThan(0);
    await writeFile(join(root, "repo-content.yaml"), "protocol: invalid\nentries: {}\n");
    const result = spawnSync("node", [cli, "build", "--format", "json"], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("repo-content");
    expect(await snapshot()).toEqual(previous);
  });
  test("removing the registry removes only obsolete symlinks", async () => {
    const root = await fixture(); await ensureRepoContentLinks(root);
    await writeFile(join(root, "repo-content/keep.md"), "user content");
    await rm(join(root, "repo-content.yaml"));
    expect((await inspectRepoContentLinks(root))[0]?.status).toBe("mismatch");
    expect((await ensureRepoContentLinks(root))[0]?.status).toBe("removed");
    expect(await readFile(join(root, "repo-content/keep.md"), "utf8")).toBe("user content");
    expect(await readFile(join(root, "docs/guide.md"), "utf8")).toContain("Stable contract");
  });
  test("line shifts relocate unchanged regions but do not hide modified or ambiguous evidence", async () => {
    const root = await fixture(); const sha = await commit(root);
    const original = await readFile(join(root, "docs/guide.md"), "utf8");
    const locator = { path: "docs/guide.md", start_line: 2, end_line: 2 };
    const reference = { source_ref: `repo-content:docs@${sha}`, locator, content_digest: articleSourceRegionDigest(original, locator) };
    await writeFile(join(root, locator.path), `New introduction\n${original}`);
    expect((await (await repoContentImpactReader(root))(reference)).state).toBe("moved");
    await writeFile(join(root, locator.path), "# Guide\nChanged contract.\n");
    expect((await (await repoContentImpactReader(root))(reference)).state).toBe("changed");
    await writeFile(join(root, locator.path), "# Guide\nOther\nStable contract.\nStable contract.\n");
    expect((await (await repoContentImpactReader(root))(reference)).state).toBe("changed");
  });
  test("generated entrance joins template navigation, reports invalid Skills and does not append custom indexes", async () => {
    const root = await fixture({ docs: { kind: "docs", path: "docs" }, skills: { kind: "skills", path: ".agents/skills" } });
    await mkdir(join(root, ".agents/skills/broken"), { recursive: true });
    await writeFile(join(root, ".agents/skills/broken/SKILL.md"), "---\nname: broken\n---\nMissing description\n");
    await writeFile(join(root, "package.json"), JSON.stringify({ context: { language: "zh-CN" } }));
    await writeFile(join(root, "docs/README.md"), "# 项目\n\n![Diagram](figure.png)\n");
    await commit(root);
    const pkg = kbPackage({ name: "example", template: { path: "templates/kb" }, repoContentPage: true });
    const pages = await repoContentPages(root, pkg);
    expect(pages[0]?.content).toContain("不可用的 README 或技能条目");
    expect(pages[0]?.content).toContain(".agents/skills/broken/SKILL.md");
    expect(pages[0]?.content).not.toContain("![Diagram]");
    expect(pages[0]?.content).toContain("[Diagram](<https://example.org");
    const vars = packageTemplateVars({ pkg, bundle: "", knowledgeCount: 0, knowledgeTimestamp: "", selected: [], navigationFiles: repoContentNavigation(pages) });
    expect(vars.knowledgeGroupsMarkdown).toContain("repo-content.md");
    expect(vars.knowledgeCount).toBe(0);
    // A page writer does not require or mutate a separately owned template.
    await writeRepoContentPages(root, pkg, pages);
    await mkdir(join(root, pkg.outDir, "wikis"), { recursive: true });
    const index = join(root, pkg.outDir, "wikis/index.md");
    await writeFile(index, "Custom navigation\n");
    await rm(join(root, pkg.outDir, pages[0]!.path));
    await writeRepoContentPages(root, pkg, pages);
    expect(await readFile(index, "utf8")).toBe("Custom navigation\n");
  });
  test("init enables an entrance only for a new declaration and preserves an existing one", async () => {
    const root = await fixture();
    await initContextProject({ cwd: root, projectDir: ".", dev: true, allowNonempty: true });
    const entry = join(root, "src/index.ts");
    expect(await readFile(entry, "utf8")).toContain("repoContentPage: true");
    const receipt = JSON.parse(execFileSync("node", [resolve(import.meta.dir, "../../dist/cli.js"), "source", "ensure", "repo-content", "--format", "json"],
      { cwd: root, encoding: "utf8" }));
    expect(receipt[0].status).toBe("repaired");
    const original = "export default { sources: [], phases: [], packages: [] };\n";
    await writeFile(entry, original);
    await initContextProject({ cwd: root, projectDir: ".", dev: true, allowNonempty: true });
    expect(await readFile(entry, "utf8")).toBe(original);
  });
  test("registry rejects remote scope and traversal; revision selectors remain exact", () => {
    for (const path of ["../docs", "/docs", "a/.git/config", "a\\b"]) {
      expect(repoContentRegistrySchema.safeParse({ protocol: "context.repo-content/v1", entries: { docs: { kind: "docs", path } } }).success).toBe(false);
    }
    expect(repoContentScopeMatches("repo-content:docs", `repo-content:docs@${"a".repeat(40)}`)).toBe(true);
    expect(repoContentScopeMatches(`repo-content:docs@${"b".repeat(40)}`, `repo-content:docs@${"a".repeat(40)}`)).toBe(false);
  });
  test("inspection is read-only; repair creates relative links and preserves ordinary conflicts", async () => {
    const root = await fixture();
    expect((await inspectRepoContentLinks(root))[0]?.status).toBe("missing");
    expect((await ensureRepoContentLinks(root))[0]?.status).toBe("repaired");
    expect(await readlink(join(root, "repo-content/docs"))).toBe("../docs");
    expect((await inspectRepoContentLinks(root))[0]?.status).toBe("ready");
    await rm(join(root, "repo-content/docs"));
    await writeFile(join(root, "repo-content/docs"), "keep me");
    expect((await ensureRepoContentLinks(root))[0]?.status).toBe("conflict");
    expect(await readFile(join(root, "repo-content/docs"), "utf8")).toBe("keep me");
  });
  test("disabled symlinks use real paths without overwriting placeholders", async () => {
    const root = await fixture();
    await repoContentGit(root, ["config", "core.symlinks", "false"]);
    await mkdir(join(root, "repo-content")); await writeFile(join(root, "repo-content/docs"), "../docs");
    expect((await ensureRepoContentLinks(root))[0]?.status).toBe("symlinks-disabled");
    expect(await readFile(join(root, "repo-content/docs"), "utf8")).toBe("../docs");
  });
  test("overlap and nested repository links fail before view creation", async () => {
    const root = await fixture({ docs: { kind: "docs", path: "docs" }, guide: { kind: "document", path: "docs/guide.md" } });
    await expect(readRepoContentRegistry(root)).rejects.toThrow("overlap");
    await mkdir(join(root, "nested/.git"), { recursive: true });
    await symlink("nested", join(root, "alias"));
    await expect(repoContentRealPath(root, "alias/file.md")).rejects.toThrow("nested repository");
  });
  test("historical evidence survives directory moves and current registration changes", async () => {
    const root = await fixture(); const sha = await commit(root);
    await rename(join(root, "docs"), join(root, "handbook"));
    await writeFile(join(root, "repo-content.yaml"), YAML.stringify({ protocol: "context.repo-content/v1", entries: { docs: { kind: "docs", path: "handbook" } } }));
    const read = await repoContentReferenceReader(root);
    expect(await read(`repo-content:docs@${sha}`, "docs/guide.md", true)).toContain("Stable contract");
    await expect(read(`repo-content:docs@${sha}`, "handbook/guide.md", true)).rejects.toThrow();
  });
  test("tracked moves outside the old directory retain historical evidence until settlement", async () => {
    const root = await fixture(); const sha = await commit(root);
    const locator = { path: "docs/guide.md", start_line: 2, end_line: 2 };
    const reference = { source_ref: `repo-content:docs@${sha}`, locator,
      content_digest: articleSourceRegionDigest(await readFile(join(root, locator.path), "utf8"), locator) };
    await rename(join(root, "docs"), join(root, "manual"));
    await writeFile(join(root, "repo-content.yaml"), YAML.stringify({ protocol: "context.repo-content/v1", entries: { docs: { kind: "docs", path: "manual" } } }));
    await repoContentGit(root, ["add", "docs", "manual", "repo-content.yaml"]);
    const before = await repoContentGit(root, ["diff", "--cached"]);
    const result = await (await repoContentImpactReader(root))(reference);
    expect(result).toMatchObject({ state: "moved", current_path: "manual/guide.md" });
    expect(result.changes[0]?.old_path).toBe("docs/guide.md");
    expect(await repoContentGit(root, ["diff", "--cached"])).toBe(before);
    expect(reference.locator.path).toBe("docs/guide.md");
  });
  test("document region digest separates an unrelated edit from a changed claim", async () => {
    const root = await fixture(); const sha = await commit(root);
    const locator = { path: "docs/guide.md", start_line: 2, end_line: 2 };
    const reference = { source_ref: `repo-content:docs@${sha}`, locator,
      content_digest: articleSourceRegionDigest(await readFile(join(root, locator.path), "utf8"), locator) };
    await writeFile(join(root, locator.path), "# Guide\nStable contract.\nChanged other detail.\n");
    expect((await (await repoContentImpactReader(root))(reference)).state).toBe("moved");
    await writeFile(join(root, locator.path), "# Guide\nChanged contract.\nOther detail.\n");
    expect((await (await repoContentImpactReader(root))(reference)).state).toBe("changed");
  });
  test("update includes repository chapters and advances evidence only after explicit no-impact", async () => {
    const root = await fixture(); const sha = await commit(root);
    const locator = { path: "docs/guide.md", start_line: 2, end_line: 2 };
    const reference = { source_ref: `repo-content:docs@${sha}`, locator,
      content_digest: articleSourceRegionDigest(await readFile(join(root, locator.path), "utf8"), locator) };
    await mkdir(join(root, "src")); await mkdir(join(root, "knowledge/faq"), { recursive: true });
    await writeFile(join(root, "src/indexers.yaml"), YAML.stringify({ requirements: [{ id: "docs", purpose: "Explain the contract",
      target_scope: { targets: [{ source_ref: "repo-content:docs" }] } }] }));
    await writeFile(join(root, "knowledge/faq/guide.md"), "---\ntitle: Guide\n---\n\n<!-- context:section id=\"contract\" -->\nThe contract.\n<!-- /context:section -->\n");
    const structure = { schema_version: "context.approved-structure.v1", articles: [{ article_id: "guide", path: "faq/guide.md", collection: "faq", visibility: "public",
      sections: [{ id: "contract", references: [reference] }] }] };
    const map = join(root, "knowledge/structure.yaml");
    await writeFile(map, YAML.stringify(structure));
    await writeFile(join(root, locator.path), "# Guide\nStable contract, clarified.\nOther detail.\n");
    await beginKnowledgeUpdate(root, { scopes: [{ requirement_ref: "docs", source_ref: "repo-content:docs" }] });
    const update = (await readKnowledgeUpdate(root))!;
    expect(update.candidates.map(item => item.path)).toEqual(["faq/guide.md"]);
    expect(JSON.stringify(update.repo_content)).toContain('"state":"changed"');
    expect(YAML.parse(await readFile(map, "utf8")).articles[0].sections[0].references[0]).toEqual(reference);
    await completeKnowledgeUpdate({ projectRoot: root, revision: update.revision, decisions: [{ path: "faq/guide.md" }],
      scope_summary: "The clarification does not change the published claim.", new_topics: [] });
    const settled = YAML.parse(await readFile(map, "utf8"));
    expect(settled.processed_scopes).toHaveLength(1);
    expect(settled.articles[0].sections[0].references[0].source_ref).toBe(`repo-content:docs@${sha}+worktree`);
    expect(settled.articles[0].sections[0].references[0].content_digest).not.toBe(reference.content_digest);
  });
  test("Skill script changes and untracked resources are candidates even with unchanged SKILL.md", async () => {
    const root = await fixture({ skills: { kind: "skills", path: ".agents/skills" } });
    await mkdir(join(root, ".agents/skills/check/scripts"), { recursive: true });
    const path = ".agents/skills/check/SKILL.md";
    const text = "---\nname: check\ndescription: Check things\n---\nRun scripts/check.sh\n";
    await writeFile(join(root, path), text);
    await writeFile(join(root, ".agents/skills/check/scripts/check.sh"), "exit 0\n");
    const sha = await commit(root);
    await writeFile(join(root, ".agents/skills/check/scripts/check.sh"), "exit 1\n");
    await writeFile(join(root, ".agents/skills/check/scripts/new.sh"), "exit 0\n");
    const locator = { path, start_line: 1, end_line: 5 };
    const result = await (await repoContentImpactReader(root))({ source_ref: `repo-content:skills@${sha}`, locator,
      content_digest: articleSourceRegionDigest(text, locator) });
    expect(result.state).toBe("changed");
    expect(result.changes.map(item => item.status)).toContain("untracked");
    expect(result.changes.some(item => item.path.endsWith("check.sh"))).toBe(true);
  });
  test("optional pages project only README and Skill summaries at HEAD, not every document", async () => {
    const root = await fixture();
    await writeFile(join(root, "docs/README.md"), "# Project\n\nOverview\n\n[Guide](guide.md)\n");
    const sha = await commit(root);
    await writeFile(join(root, "docs/README.md"), "# Uncommitted replacement\n");
    expect(await repoContentPages(root, kbPackage({ name: "example", template: { path: "templates/kb" } }))).toEqual([]);
    const pages = await repoContentPages(root, kbPackage({ name: "example", template: { path: "templates/kb" }, repoContentPage: true }));
    expect(pages).toHaveLength(1);
    expect(pages[0]?.content).toContain(`/blob/${sha}/docs/guide.md`);
    expect(pages[0]?.content).not.toContain("Uncommitted replacement");
    expect(pages[0]?.content).not.toContain("Stable contract");
    expect((await repoContentLinkProjector(root))("See [Guide](context:repo/docs/guide.md)")).toContain("/blob/main/docs/guide.md");
  });
});
