import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { captureLark, createArticleSourceReference, source } from "@c4a/context";
import { createDocumentSnapshotManifest } from "@c4a/extract";
import type { LarkRunner } from "../lib/feishu.js";
import { createLarkCaptureProject, makeLarkCaptureTmp } from "./projectCaptureLarkV062.fixtures.js";
import { runCaptureLarkPhase } from "../project/documentCaptureLark.js";
import { beginKnowledgeUpdate, completeKnowledgeUpdate, readKnowledgeUpdate } from "../project/knowledgeUpdate.js";
import { currentScopeSourceVersion } from "../project/processedScopeStorage.js";
import { inspectWorkspaceVersion, recordWorkspaceVersion } from "../project/workspaceChangelog.js";
import { approvedStructureInputHashFor } from "../project/close.js";
import { beginFormatOnlyUpdate } from "../project/formatOnlyUpdate.js";
import { applyFormatOnlyReferences } from "../project/formatOnlyReferences.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const scope = { requirement_ref: "handbook", source_ref: "lark:handbook" };
const articlePath = "architecture/cache.md";
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
const runner = (formatted: boolean): LarkRunner => async args => args.includes("--help")
  ? { stdout: "Flags:\n --api-version string\n --doc-format string\n", stderr: "", exitCode: 0 }
  : { stdout: JSON.stringify({ ok: true, data: { title: "Cache Handbook", revision_id: formatted ? "rev-002" : "rev-001",
    document: { content: `<title>Cache Handbook</title><p>The ${formatted ? "<strong>cache</strong>" : "cache"} is shared.</p>` } } }), stderr: "", exitCode: 0 };
async function capture(root: string, formatted: boolean) {
  return runCaptureLarkPhase({ projectRoot: root, phase: captureLark({ source: source("handbook") }),
    larkRunner: runner(formatted), now: new Date(formatted ? "2026-01-02T00:00:00Z" : "2026-01-01T00:00:00Z") });
}
async function fixture() {
  const outer = makeLarkCaptureTmp(); roots.push(outer);
  const root = await createLarkCaptureProject(outer);
  await capture(root, false);
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify({ requirements: [{ id: "handbook", purpose: "Explain the cache",
    target_scope: { targets: [{ source_ref: scope.source_ref }] }, exclusions: [] }] }));
  const text = await readFile(join(root, "sources/lark/handbook/index.md"), "utf8");
  const line = text.split("\n").findIndex(value => value.includes("cache")) + 1;
  const reference = createArticleSourceReference(scope.source_ref, { path: "index.md", start_line: line, end_line: line }, text);
  const article = { article_id: "article:cache", path: articlePath, collection: "architecture", visibility: "public",
    sections: [{ id: "behavior", references: [reference] }] };
  await mkdir(join(root, "knowledge/architecture"), { recursive: true });
  await writeFile(join(root, `knowledge/${articlePath}`), '---\ntitle: Shared cache\ndescription: How the cache is shared.\n---\n\n<!-- context:section id="behavior" -->\nThe cache is shared.\n<!-- /context:section -->\n');
  await writeFile(join(root, "knowledge/structure.yaml"), YAML.stringify({ schema_version: 1,
    input_hash: await approvedStructureInputHashFor(root, [article]), articles: [article],
    processed_scopes: [{ ...scope, processed_version: await currentScopeSourceVersion(root, scope.source_ref) }] }));
  git(root, "init", "-q"); git(root, "config", "user.name", "Example"); git(root, "config", "user.email", "author@example.test");
  git(root, "add", "-f", "sources", "knowledge", "src", "package.json"); git(root, "commit", "-qm", "Captured baseline");
  await recordWorkspaceVersion(root, { version: "0.1.0", title: "Initial guide", changes: ["Describe the cache"],
    triggers: [{ kind: "initial", description: "Initial guide" }], expected_digest: (await inspectWorkspaceVersion(root)).expected_digest });
  expect((await inspectWorkspaceVersion(root)).current).toBe(true);
  return root;
}

for (const unrelated of [false, true]) test(`Lark format capture and source-update decision preserve the article; unrelated edits ${unrelated}`, async () => {
  const root = await fixture();
  const bodyPath = join(root, `knowledge/${articlePath}`), body = await readFile(bodyPath, "utf8");
  await capture(root, true);
  if (unrelated) await writeFile(join(root, "src/unrelated.md"), "Independent source change");
  expect((await inspectWorkspaceVersion(root)).changed).toBe(true);
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const request = (await readKnowledgeUpdate(root))!;
  expect(request.format_only_proposals).toHaveLength(1);
  expect(request.format_only_proposals![0]!.changes[0]).toMatchObject({ article: articlePath,
    before_text: "The cache is shared.", after_text: "The **cache** is shared." });
  const result = await completeKnowledgeUpdate({ projectRoot: root, revision: request.revision,
    decisions: request.candidates.map(({ path }) => ({ path })), new_topics: [], scope_summary: "No new topic or behavior change.",
    format_only: [{ source_ref: scope.source_ref, reason: "Bold emphasis changes rendering without changing the cache behavior." }] });
  expect(result).toMatchObject({ outcome: "unchanged", version_exempt: !unrelated });
  expect(await readFile(bodyPath, "utf8")).toBe(body);
  const status = await inspectWorkspaceVersion(root);
  expect(status.changed).toBe(unrelated); expect(status.current).toBe(!unrelated);
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  expect(structure.articles[0].sections[0].references[0].content_digest).toBe(request.format_only_proposals![0]!.changes[0]!.after.content_digest);
}, 60_000);

test("a JSON null disposable baseline does not block a current workspace", async () => {
  const root = await fixture();
  await writeFile(join(root, ".tmp/context-runtime/format-only-update.json"), "null");
  await beginFormatOnlyUpdate(root);
  const baseline = JSON.parse(await readFile(join(root, ".tmp/context-runtime/format-only-update.json"), "utf8"));
  expect(baseline.version).toBe("0.1.0");
});

test.each([false, true])("a format-only decision safely resumes after references were written (approval write lost: %s)", async lostApproval => {
  const root = await fixture();
  const bodyPath = join(root, `knowledge/${articlePath}`), body = await readFile(bodyPath, "utf8");
  await capture(root, true);
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const request = (await readKnowledgeUpdate(root))!;
  const baselinePath = join(root, ".tmp/context-runtime/format-only-update.json");
  const baseline = await readFile(baselinePath, "utf8");
  const decisions = [{ source_ref: scope.source_ref, reason: "Only bold emphasis changed." }];
  // Preserve the request as if a later approval write or cleanup had failed.
  await applyFormatOnlyReferences(root, request.format_only_proposals!, decisions, request.scopes);
  if (lostApproval) await writeFile(baselinePath, baseline);
  expect(await readKnowledgeUpdate(root)).toEqual(request);
  const result = await completeKnowledgeUpdate({ projectRoot: root, revision: request.revision,
    decisions: request.candidates.map(({ path }) => ({ path })), new_topics: [], scope_summary: "No behavior change.", format_only: decisions });
  expect(result).toMatchObject({ outcome: "unchanged", version_exempt: true });
  expect((await inspectWorkspaceVersion(root)).current).toBe(true);
  expect(await readFile(bodyPath, "utf8")).toBe(body);
  expect(await readKnowledgeUpdate(root)).toBeUndefined();
}, 60_000);

test("an already applied format-only proposal still rejects source changes on retry", async () => {
  const root = await fixture();
  await capture(root, true);
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const request = (await readKnowledgeUpdate(root))!;
  const decisions = [{ source_ref: scope.source_ref, reason: "Only bold emphasis changed." }];
  await applyFormatOnlyReferences(root, request.format_only_proposals!, decisions, request.scopes);
  const structure = await readFile(join(root, "knowledge/structure.yaml"), "utf8");
  await writeFile(join(root, "sources/lark/handbook/index.md"), "A different fact.\n");
  await expect(applyFormatOnlyReferences(root, request.format_only_proposals!, decisions, request.scopes)).rejects.toThrow("Captured source changed");
  expect(await readFile(join(root, "knowledge/structure.yaml"), "utf8")).toBe(structure);
  expect((await inspectWorkspaceVersion(root)).changed).toBe(true);
}, 60_000);

test("format mapping ignores Git colour preferences and still locates shifted text", async () => {
  const root = await fixture();
  git(root, "config", "diff.interHunkContext", "100");
  const count = process.env.GIT_CONFIG_COUNT, key = process.env.GIT_CONFIG_KEY_0, value = process.env.GIT_CONFIG_VALUE_0;
  process.env.GIT_CONFIG_COUNT = "1"; process.env.GIT_CONFIG_KEY_0 = "color.ui"; process.env.GIT_CONFIG_VALUE_0 = "always";
  try {
    const read: LarkRunner = async args => args.includes("--help") ? runner(true)(args) : {
      stdout: JSON.stringify({ ok: true, data: { title: "Cache Handbook", revision_id: "shifted", document: {
        content: "<title>Cache Handbook</title><p>New preface.</p><p>The <strong>cache</strong> is shared.</p>",
      } } }), stderr: "", exitCode: 0 };
    await runCaptureLarkPhase({ projectRoot: root, phase: captureLark({ source: source("handbook") }), larkRunner: read });
    await beginKnowledgeUpdate(root, { scopes: [scope] });
    const request = (await readKnowledgeUpdate(root))!;
    const change = request.format_only_proposals![0]!.changes[0]!;
    expect(change.after_text).toContain("**cache**");
    expect(change.after.locator.end_line).toBeGreaterThan(change.before.locator.end_line);
  } finally {
    for (const [name, old] of [["GIT_CONFIG_COUNT", count], ["GIT_CONFIG_KEY_0", key], ["GIT_CONFIG_VALUE_0", value]]) {
      if (old === undefined) delete process.env[name!]; else process.env[name!] = old;
    }
  }
});

test("a stale disposable format baseline is replaced only from an independently current workspace", async () => {
  const root = await fixture();
  await beginFormatOnlyUpdate(root);
  const path = join(root, ".tmp/context-runtime/format-only-update.json");
  const stale = JSON.parse(await readFile(path, "utf8")); stale.version = "0.0.1";
  await writeFile(path, JSON.stringify(stale));
  await beginFormatOnlyUpdate(root);
  expect(JSON.parse(await readFile(path, "utf8")).version).toBe("0.1.0");
  await writeFile(path, JSON.stringify(stale));
  await writeFile(join(root, "unrelated.md"), "unrecorded");
  await beginFormatOnlyUpdate(root);
  expect(JSON.parse(await readFile(path, "utf8")).version).toBe("0.0.1");
});

test("a formatted article still reports changed citations from its other sources", async () => {
  const root = await fixture(); const other = { requirement_ref: "handbook", source_ref: "lark:other" };
  const registryPath = join(root, "sources/lark/index.yaml"), registry = YAML.parse(await readFile(registryPath, "utf8"));
  registry.sources.push({ name: "other", docToken: "other-token" }); await writeFile(registryPath, YAML.stringify(registry));
  await cp(join(root, "sources/lark/handbook"), join(root, "sources/lark/other"), { recursive: true });
  const manifestPath = join(root, "sources/lark/other/manifest.json");
  const previous = JSON.parse(await readFile(manifestPath, "utf8")); previous.source_name = "other";
  await writeFile(manifestPath, JSON.stringify(previous));
  const structurePath = join(root, "knowledge/structure.yaml"), structure = YAML.parse(await readFile(structurePath, "utf8"));
  const first = structure.articles[0].sections[0].references[0];
  structure.articles[0].sections[0].references.push({ ...first, source_ref: other.source_ref });
  structure.processed_scopes.push({ ...other, processed_version: await currentScopeSourceVersion(root, other.source_ref) });
  structure.input_hash = await approvedStructureInputHashFor(root, structure.articles);
  await writeFile(structurePath, YAML.stringify(structure));
  const requirementsPath = join(root, "src/indexers.yaml"), requirements = YAML.parse(await readFile(requirementsPath, "utf8"));
  requirements.requirements[0].target_scope.targets.push({ source_ref: other.source_ref });
  await writeFile(requirementsPath, YAML.stringify(requirements));
  git(root, "add", "sources", "knowledge", "src"); git(root, "commit", "-qm", "Second evidence source");
  const text = "# Other\n\nA substantially different behavior.\n";
  await writeFile(join(root, "sources/lark/other/index.md"), text);
  await writeFile(manifestPath, JSON.stringify(createDocumentSnapshotManifest({ sourceType: "lark", sourceName: "other",
    files: [{ path: "index.md", bytes: text, title: "Other" }], capturedAt: "2026-01-03T00:00:00.000Z" })));
  await capture(root, true);
  await beginKnowledgeUpdate(root, { scopes: [scope, other] }); const request = (await readKnowledgeUpdate(root))!;
  const result = await completeKnowledgeUpdate({ projectRoot: root, revision: request.revision,
    decisions: request.candidates.map(({ path }) => ({ path })), new_topics: [], scope_summary: "Keep the page and flag the changed evidence.",
    format_only: [{ source_ref: scope.source_ref, reason: "Only emphasis changed." }] });
  expect(result).toMatchObject({ reference_warnings: [expect.objectContaining({ source_ref: other.source_ref })] });
});

test("updating a document does not require an unrelated repository checkout", async () => {
  const root = await fixture();
  await mkdir(join(root, "sources/repo"), { recursive: true });
  await writeFile(join(root, "sources/repo/index.yaml"), YAML.stringify({ sources: [{ name: "20261107", modules: [{ name: "unavailable", local: "missing-checkout",
    materializedAt: "sources/repo/unavailable", git: { remote: "https://example.test/unavailable.git", ref: "a".repeat(40) } }] }] }));
  const structurePath = join(root, "knowledge/structure.yaml");
  const structure = YAML.parse(await readFile(structurePath, "utf8"));
  structure.articles[0].sections[0].references.push(createArticleSourceReference("repo:20261107/unavailable", { path: "index.ts", start_line: 1, end_line: 1 }, "export const answer = 42;"));
  await writeFile(structurePath, YAML.stringify(structure));
  await capture(root, true);
  expect((await beginKnowledgeUpdate(root, { scopes: [scope] })).outcome).toBe("update-prepared");
  const request = (await readKnowledgeUpdate(root))!;
  expect(request.outside_scope).toContainEqual(expect.objectContaining({ source_ref: "repo:20261107/unavailable", state: "unavailable", reason: expect.stringContaining("context source recovery-plan") }));
});
