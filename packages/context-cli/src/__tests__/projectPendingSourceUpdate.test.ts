import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { readProcessedScopes } from "@c4a/context";
import { DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { completeCurrentIndexerAction } from "./knowledgeMapReview.fixture.js";
import { beginKnowledgeUpdate, readKnowledgeUpdate } from "../project/knowledgeUpdate.js";
import { inspectPendingSourceUpdates, pendingSourceUpdateScopes } from "../project/pendingSourceUpdates.js";
import { verifyProjectWorkspace } from "../project/verify.js";
import { suggestedCitation } from "../project/approvedRevisionReferences.js";
import { collectProjectStatus } from "../project/status.js";
import { completeApprovedRevision, readApprovedRevision } from "../project/approvedRevision.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const scope = { requirement_ref: "workspace-knowledge", source_ref: DOCUMENT_REVISION_SOURCE_REF, module_refs: ["module:app"] };
const baseline = async (root: string) => readProcessedScopes(YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8")));

async function settledKnowledge() {
  const root = await initialRevisionKnowledge(roots);
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const update = (await readKnowledgeUpdate(root))!;
  const status = await collectProjectStatus(root, { managed: true });
  await completeCurrentIndexerAction({ cwd: root, revision: status.workflow.current!.revision, managed: true,
    value: { stage: "source-update", decisions: update.candidates.map(({ path }) => ({ path })),
      scope_summary: "Both published constants match the current source.", new_topics: [] } });
  return root;
}

async function moveRegistration(root: string, file: string, content: string) {
  const source = join(root, "fixture-source");
  await writeFile(join(source, file), content);
  execFileSync("git", ["add", file], { cwd: source });
  execFileSync("git", ["commit", "-qm", `change ${file}`], { cwd: source });
  const version = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  const registry = join(root, "sources/repo/index.yaml");
  const parsed = YAML.parse(await readFile(registry, "utf8"));
  parsed.sources[0].modules[0].git.ref = version;
  await writeFile(registry, YAML.stringify(parsed));
  return version;
}

async function decide(root: string, decisions: Array<{ path: string }>) {
  const status = await collectProjectStatus(root, { managed: true });
  return completeCurrentIndexerAction({ cwd: root, revision: status.workflow.current!.revision, managed: true,
    value: { stage: "source-update", decisions, scope_summary: "The new export needs no page.", new_topics: [] } });
}

async function moveCitedTextAndAddExport(root: string) {
  const original = await readFile(join(root, "fixture-source/src/index.ts"), "utf8");
  return moveRegistration(root, "src/index.ts", `// moved header\n${original}\nexport const newPublicFeature = true;\n`);
}

test("a pending update with only moved citations still requires the scope decision before settling", async () => {
  const root = await settledKnowledge();
  expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "current" });
  const before = await baseline(root);
  const version = await moveCitedTextAndAddExport(root);
  expect(await pendingSourceUpdateScopes(root)).toEqual([scope]);
  expect((await collectProjectStatus(root)).workflow.current?.node).toBe("process-source-update");
  expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "update-prepared" });
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.candidates).toEqual([]);
  expect(update.changed_references).toBeUndefined();
  expect(await baseline(root)).toEqual(before);
  expect(await pendingSourceUpdateScopes(root)).toEqual([scope]);
  await decide(root, []);
  expect((await baseline(root)).map(entry => entry.processed_version)).toEqual([version]);
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  expect(structure.articles.map((article: { sections: Array<{ references: Array<{ locator: { start_line: number } }> }> }) =>
    article.sections[0]!.references[0]!.locator.start_line)).toEqual([2, 2]);
  expect(await pendingSourceUpdateScopes(root)).toEqual([]);
});

test("the scope decision can revise an existing page whose citations are unchanged", async () => {
  const root = await settledKnowledge();
  const before = await baseline(root);
  await moveCitedTextAndAddExport(root);
  await beginKnowledgeUpdate(root, undefined, { pending: true });
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.candidates).toEqual([]);
  expect(update.scope_pages).toEqual(["architecture/overview.md", "architecture/usage.md"]);
  const status = await collectProjectStatus(root, { managed: true });
  expect(await completeCurrentIndexerAction({ cwd: root, revision: status.workflow.current!.revision, managed: true,
    value: { stage: "source-update", decisions: [{ path: "architecture/overview.md", instruction: "Mention newPublicFeature." }],
      scope_summary: "The overview introduces the new export.", new_topics: [] } })).toMatchObject({ outcome: "revisions-prepared" });
  expect((await readApprovedRevision(root))?.target.path).toBe("architecture/overview.md");
  expect(await baseline(root)).toEqual(before);
});

test("digest relocation in a shallow checkout confirms moved citations without fetching history", async () => {
  const root = await settledKnowledge();
  const source = join(root, "fixture-source");
  const processed = (await baseline(root))[0]!.processed_version;
  await moveCitedTextAndAddExport(root);
  const checkout = join(root, "sources/repo/20260903/revision-fixture");
  await rm(checkout, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--depth=1", `file://${source}`, checkout]);
  await rm(join(root, ".tmp/context-runtime/source-regions"), { recursive: true, force: true });
  const trace = join(root, ".tmp/git-trace.log");
  process.env.GIT_TRACE = trace;
  try { await beginKnowledgeUpdate(root, undefined, { pending: true }); }
  finally { delete process.env.GIT_TRACE; }
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.changed_references).toBeUndefined();
  expect(update.candidates).toEqual([]);
  // File history is not read; only the processed commit's trees are fetched, to list uncited changes.
  const fetches = (await readFile(trace, "utf8")).split("\n").filter(line => line.includes("built-in: git fetch"));
  expect(fetches).toHaveLength(1);
  expect(fetches[0]).toContain(processed);
  // Only the cited file changed; an incomparable checkout would report an unavailable entry instead.
  expect(update.uncited_changes).toBeUndefined();
});

test("a pending update asks only about pages whose cited text changed and keeps the old baseline until decided", async () => {
  const root = await settledKnowledge();
  const before = await baseline(root);
  const version = await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "update-prepared" });
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.scopes).toEqual([{ ...scope, processed_version: version }]);
  expect(update.changed_references?.length).toBeGreaterThan(0);
  expect(new Set(update.candidates.map(candidate => candidate.path)))
    .toEqual(new Set(update.changed_references!.map(reference => reference.path)));
  expect(await baseline(root)).toEqual(before);
  await expect(beginKnowledgeUpdate(root, undefined, { pending: true })).rejects.toThrow("active task");
  // The Route names the evidence file instead of repeating excerpts inline.
  const input = (await collectProjectStatus(root, { managed: true })).workflow.current!.action!.input as Record<string, unknown>;
  expect(input.reference_evidence).toBeUndefined();
  expect(input.reference_evidence_count).toBe(update.reference_evidence!.length);
  expect(JSON.parse(await readFile(join(root, input.reference_evidence_file as string), "utf8"))).toEqual(update.reference_evidence);
  // Same lines, new text: repeating the line numbers would keep the old evidence, so a quote is suggested.
  expect(update.reference_evidence!.map(item => item.suggested)).toEqual(update.reference_evidence!.map(() => expect.objectContaining({
    start_line: 1, end_line: 1, text: "export const answer = 43;",
    locator: { path: "src/index.ts", quote: "export const answer = 43;" } })));
});

test("the update request lists uncited changes by directory, with new directories first", async () => {
  const root = await settledKnowledge();
  const source = join(root, "fixture-source");
  const write = async (path: string, text: string) => {
    await mkdir(join(source, path, ".."), { recursive: true });
    await writeFile(join(source, path), text);
  };
  await write("src/plugins/goals/index.ts", "export const goals = [];\n");
  await write("src/plugins/goals/view.ts", "export const view = 1;\n");
  await write("pnpm-lock.yaml", "lockfileVersion: 9\n");
  await write("dist/index.js", "export {};\n");
  await write("src/build/compiler.ts", "export const compile = () => 1;\n");
  await write("README.md", "# changed\n");
  execFileSync("git", ["add", "-A"], { cwd: source });
  const from = (await baseline(root))[0]!.processed_version;
  const to = await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  await beginKnowledgeUpdate(root, undefined, { pending: true });
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.uncited_changes).toEqual([{ source_ref: DOCUMENT_REVISION_SOURCE_REF, from, to, excluded_files: 2, groups: [
    { directory: "src/plugins", added: 2, modified: 0, deleted: 0, new_directory: true },
    // A hand-written build/ directory is not taken as generated output.
    { directory: "src/build", added: 1, modified: 0, deleted: 0, new_directory: true },
    expect.objectContaining({ directory: "." }),
  ] }]);
  // The cited file is a changed reference, never an uncited change.
  expect(update.uncited_changes![0]!.groups.some(group => group.directory === "src")).toBe(false);
  const input = (await collectProjectStatus(root, { managed: true })).workflow.current!.action!.input as Record<string, unknown>;
  expect(input.uncited_changes).toEqual(update.uncited_changes);
});

test("uncited changes are reported unknown, not absent, when the processed commit cannot be fetched", async () => {
  const root = await settledKnowledge();
  const source = join(root, "fixture-source");
  await writeFile(join(source, "README.md"), "# changed\n");
  execFileSync("git", ["add", "-A"], { cwd: source });
  await moveCitedTextAndAddExport(root);
  const checkout = join(root, "sources/repo/20260903/revision-fixture");
  await rm(checkout, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--depth=1", `file://${source}`, checkout]);
  execFileSync("git", ["remote", "set-url", "origin", join(root, "missing-remote")], { cwd: checkout });
  expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "update-prepared" });
  expect((await readKnowledgeUpdate(root))!.uncited_changes).toEqual([expect.objectContaining({
    groups: [], unavailable: expect.stringContaining("uncited changes are unknown") })]);
});

test("source-update evidence suggests the mapped lines of a rewritten repository citation", async () => {
  const root = await settledKnowledge();
  await moveRegistration(root, "src/index.ts", "// header\nexport const answer = 43;\n");
  await beginKnowledgeUpdate(root, undefined, { pending: true });
  const evidence = (await readKnowledgeUpdate(root))!.reference_evidence!;
  expect(evidence.length).toBeGreaterThan(0);
  for (const item of evidence) expect(item.suggested).toMatchObject({ start_line: 1, end_line: 2,
    text: "// header\nexport const answer = 43;", locator: { path: "src/index.ts", start_line: 1, end_line: 2 } });
});

test("a pending update prepares a missing processed commit and its old contents before reading history", async () => {
  const root = await settledKnowledge();
  const version = await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  // A partial clone of only the new commit: the processed commit and its contents are absent.
  const { checkout } = await partialCloneCheckout(root);
  const processed = (await baseline(root))[0]!.processed_version;
  expect(() => execFileSync("git", ["-C", checkout, "cat-file", "-e", `${processed}^{commit}`], { stdio: "ignore", env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } })).toThrow();
  expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "update-prepared" });
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.scopes[0]?.processed_version).toBe(version);
  expect(update.reference_evidence!.length).toBeGreaterThan(0);
  for (const item of update.reference_evidence!) {
    expect(item.history).toMatchObject({ status: "available", text: "export const answer = 42;", commit: processed });
    expect(item.suggested?.locator).toEqual({ path: "src/index.ts", quote: "export const answer = 43;" });
  }
  expect(update.uncited_changes).toBeUndefined();
});

test("a registered commit that cannot be fetched is tried once per update", async () => {
  const root = await settledKnowledge();
  const source = join(root, "fixture-source");
  const checkout = join(root, "sources/repo/20260903/revision-fixture");
  await rm(checkout, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--depth=1", `file://${source}`, checkout]);
  await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  execFileSync("git", ["-C", checkout, "remote", "set-url", "origin", join(root, "missing-remote")]);
  const trace = join(root, ".tmp/git-trace.log");
  process.env.GIT_TRACE = trace;
  try {
    // The reason the fetch failed is part of the message.
    await expect(beginKnowledgeUpdate(root, undefined, { pending: true })).rejects.toThrow(/could not be fetched \(git fetch of commit [0-9a-f]{12} failed: .+\)\. Check that the registered commit SHA exists/u);
  } finally { delete process.env.GIT_TRACE; }
  expect((await readFile(trace, "utf8")).split("\n").filter(line => line.includes("built-in: git fetch"))).toHaveLength(1);
  expect(await readKnowledgeUpdate(root)).toBeUndefined();
});

test("an explicit update reads only what the checkouts have", async () => {
  const root = await settledKnowledge();
  const source = join(root, "fixture-source");
  const checkout = join(root, "sources/repo/20260903/revision-fixture");
  await rm(checkout, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--depth=1", `file://${source}`, checkout]);
  await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  const trace = join(root, ".tmp/git-trace.log");
  process.env.GIT_TRACE = trace;
  try {
    await expect(beginKnowledgeUpdate(root, { scopes: [scope] })).rejects.toThrow(/context update --pending fetches it; an explicit update reads only what the checkout has/u);
  } finally { delete process.env.GIT_TRACE; }
  expect((await readFile(trace, "utf8").catch(() => "")).split("\n").filter(line => line.includes("built-in: git fetch"))).toHaveLength(0);
  expect(await readKnowledgeUpdate(root)).toBeUndefined();
});

test("status stays local while a pending update fetches a newly registered commit the checkout lacks", async () => {
  const root = await settledKnowledge();
  const source = join(root, "fixture-source");
  const checkout = join(root, "sources/repo/20260903/revision-fixture");
  await rm(checkout, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--depth=1", `file://${source}`, checkout]);
  const version = await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  const trace = join(root, ".tmp/git-trace.log");
  const fetches = async () => (await readFile(trace, "utf8").catch(() => "")).split("\n").filter(line => line.includes("built-in: git fetch")).length;
  process.env.GIT_TRACE = trace;
  try {
    await collectProjectStatus(root, { managed: true });
    expect(await fetches()).toBe(0);
    expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "update-prepared" });
    expect(await fetches()).toBe(1);
  } finally { delete process.env.GIT_TRACE; }
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.scopes[0]?.processed_version).toBe(version);
  expect(update.changed_references?.some(reference => reference.state === "unavailable")).toBe(false);
  expect(update.changed_references?.length).toBeGreaterThan(0);
});

test("missing processed versions and malformed structures report unknown rather than current", async () => {
  const { createDocumentRevisionWorkspace } = await import("./projectDocumentRevisionV074.fixture.js");
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  expect(await inspectPendingSourceUpdates(root)).toMatchObject({ state: "unknown", scopes: [],
    issues: [expect.objectContaining({ reason_code: "processed-version-missing" })] });
  expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "unknown" });
  await writeFile(join(root, "knowledge/structure.yaml"), "articles: [invalid");
  expect(await inspectPendingSourceUpdates(root)).toMatchObject({ state: "unknown", scopes: [],
    issues: [expect.objectContaining({ reason_code: "processed-structure-invalid" })] });
});

test("unknown baselines do not hide another confirmed pending update", async () => {
  const root = await settledKnowledge();
  await moveCitedTextAndAddExport(root);
  const path = join(root, "src/indexers.yaml"); const requirements = YAML.parse(await readFile(path, "utf8"));
  requirements.requirements[0].target_scope.targets.push({ source_ref: "repo:unprocessed-source" });
  await writeFile(path, YAML.stringify(requirements));
  const pending = await inspectPendingSourceUpdates(root);
  expect(pending.state).toBe("pending"); expect(pending.scopes).toEqual([scope]);
  expect(pending.issues.some(issue => issue.source_ref === "repo:unprocessed-source")).toBe(true);
  expect((await collectProjectStatus(root)).workflow.current?.node).toBe("process-source-update");
  expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "update-prepared", diagnostics: pending.issues });
});

test("unreadable registries produce an unknown diagnostic rather than throwing", async () => {
  const root = await settledKnowledge();
  await writeFile(join(root, "sources/repo/index.yaml"), "sources: [invalid");
  expect(await inspectPendingSourceUpdates(root)).toMatchObject({ state: "unknown", scopes: [],
    issues: [{ reason_code: "source-registry-unreadable" }] });
});

// A real partial clone, as `git clone --filter=blob:none` writes it: only what was
// checked out has contents; the promisor remote is `remote.origin.promisor`.
async function partialCloneCheckout(root: string, options: { checkout?: boolean } = {}) {
  const source = join(root, "fixture-source");
  execFileSync("git", ["config", "uploadpack.allowFilter", "true"], { cwd: source });
  execFileSync("git", ["config", "uploadpack.allowAnySHA1InWant", "true"], { cwd: source });
  const checkout = join(root, "sources/repo/20260903/revision-fixture");
  await rm(checkout, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--depth=1", "--filter=blob:none", ...(options.checkout === false ? ["--no-checkout"] : []), `file://${source}`, checkout]);
  const config = execFileSync("git", ["-C", checkout, "config", "--local", "-l"], { encoding: "utf8" });
  expect(config).toContain("remote.origin.promisor=true");
  expect(config).not.toContain("extensions.partialclone");
  return { source, checkout };
}

test("a partial clone downloads only the missing cited contents in the update; status stays local", async () => {
  const root = await settledKnowledge();
  const { checkout } = await partialCloneCheckout(root, { checkout: false });
  const version = await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  const before = execFileSync("git", ["-C", checkout, "status", "--porcelain"], { encoding: "utf8" });
  const trace = join(root, ".tmp/git-trace.log");
  const fetches = async () => (await readFile(trace, "utf8").catch(() => "")).split("\n").filter(line => line.includes("built-in: git fetch")).length;
  process.env.GIT_TRACE = trace;
  try {
    await collectProjectStatus(root, { managed: true });
    await verifyProjectWorkspace(root, { checkSourceRegions: true });
    expect(await fetches()).toBe(0);
    expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "update-prepared" });
  } finally { delete process.env.GIT_TRACE; }
  // One commit fetch and one batch of current contents; old contents only for changed citations.
  expect(await fetches()).toBeLessThanOrEqual(3);
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.scopes[0]?.processed_version).toBe(version);
  expect(update.changed_references?.length).toBeGreaterThan(0);
  expect(update.changed_references?.some(reference => reference.state === "unavailable")).toBe(false);
  // Only objects were added: the checkout's files are untouched.
  expect(execFileSync("git", ["-C", checkout, "status", "--porcelain"], { encoding: "utf8" })).toBe(before);
});

test("current contents that cannot be downloaded stop the update with the facts", async () => {
  const root = await settledKnowledge();
  const { checkout } = await partialCloneCheckout(root, { checkout: false });
  const version = await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  execFileSync("git", ["-C", checkout, "fetch", "-q", "--depth=1", "--filter=blob:none", "origin", version]);
  execFileSync("git", ["-C", checkout, "remote", "set-url", "origin", `file://${join(root, "missing-remote")}`]);
  await expect(beginKnowledgeUpdate(root, undefined, { pending: true })).rejects.toThrow(/not downloaded \(download failed: /u);
  expect(await readKnowledgeUpdate(root)).toBeUndefined();
});

test("old contents that cannot be downloaded do not block the update", async () => {
  const root = await settledKnowledge();
  const { checkout } = await partialCloneCheckout(root, { checkout: false });
  const version = await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  // The new commit and its cited contents are local; the old commit's contents are not reachable.
  execFileSync("git", ["-C", checkout, "fetch", "-q", "--depth=1", "--filter=blob:none", "origin", version]);
  execFileSync("git", ["-C", checkout, "-c", "core.sparseCheckout=false", "checkout", "-q", "--detach", version]);
  execFileSync("git", ["-C", checkout, "remote", "set-url", "origin", `file://${join(root, "missing-remote")}`]);
  expect(await beginKnowledgeUpdate(root, undefined, { pending: true })).toMatchObject({ outcome: "update-prepared" });
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.changed_references?.some(reference => reference.state === "unavailable")).toBe(false);
});

test("status tells contents not downloaded apart from a missing path, offline", async () => {
  const root = await settledKnowledge();
  await partialCloneCheckout(root, { checkout: false });
  const { registeredArticleSourceReader } = await import("../project/articleSourceReader.js");
  const read = await registeredArticleSourceReader(root);
  await expect(read(DOCUMENT_REVISION_SOURCE_REF, "src/index.ts")).rejects.toMatchObject({ detail: { reason_code: "source-content-missing" } });
  const fresh = await registeredArticleSourceReader(root);
  await expect(fresh(DOCUMENT_REVISION_SOURCE_REF, "src/no-such-file.ts")).rejects.toMatchObject({ detail: { reason_code: "source-file-missing" } });
});

test("a blocked citation names where its old lines now are, from local history", async () => {
  const root = await settledKnowledge();
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  await moveRegistration(root, "src/index.ts", "// header\nexport const answer = 43;\n");
  expect(await suggestedCitation(root, structure.articles[0].sections[0].references[0], structure.articles[0].sections))
    .toBe("the old text now maps to lines 1-2");
});

test("a source-update revision cannot keep a citation the processed version no longer has", async () => {
  const root = await settledKnowledge();
  await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  await beginKnowledgeUpdate(root, undefined, { pending: true });
  const status = await collectProjectStatus(root, { managed: true });
  await completeCurrentIndexerAction({ cwd: root, revision: status.workflow.current!.revision, managed: true,
    value: { stage: "source-update", decisions: [{ path: "architecture/overview.md", instruction: "Describe the new value." },
      { path: "architecture/usage.md", instruction: "Describe the new value." }],
      scope_summary: "The value changed.", new_topics: [] } });
  const request = (await readApprovedRevision(root))!;
  expect(request.processed_scopes?.length).toBeGreaterThan(0);
  const section = request.target.sections[0]!.id;
  // The writer changes the prose but does not re-cite: the stale citation blocks with the facts.
  const markdown = request.target.markdown.replace("value 42.", "value 43.");
  const error = await completeApprovedRevision({ projectRoot: root, revision: request.revision, markdown, preview: true }).catch(value => value);
  expect(error).toMatchObject({ reason: "processed-reference-stale" });
  expect(error.message).toContain(`Fragment ${section}: ${DOCUMENT_REVISION_SOURCE_REF} src/index.ts:1-1 is not-found`);
  // Re-citing the current text passes.
  const preview = await completeApprovedRevision({ projectRoot: root, revision: request.revision, preview: true,
    markdown, sections: [{ section_id: section, references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path: "src/index.ts", quote: "export const answer = 43;" } }] }] });
  expect(preview.changed).toBe(true);
});

test("verify reports missing local downloads and commits as unchecked, and a deleted file as a change", async () => {
  const root = await settledKnowledge();
  const codes = async () => (await verifyProjectWorkspace(root, { checkSourceRegions: true })).issues
    .filter(issue => issue.code.startsWith("approved-source-region") || issue.code === "source-read-failed");
  // Contents not downloaded in a partial clone.
  await partialCloneCheckout(root, { checkout: false });
  const missingContents = await codes();
  expect(missingContents.map(issue => issue.code)).toEqual(["source-read-failed"]);
  expect(missingContents[0]!.message).toContain("not downloaded");
  // A registered commit the checkout does not have yet.
  await moveRegistration(root, "src/index.ts", "export const answer = 43;\n");
  const missingCommit = await codes();
  expect(missingCommit.map(issue => issue.code)).toEqual(["source-read-failed"]);
  expect(missingCommit[0]!.message).toContain("registered commit is not in the source checkout");
  // A file the registered commit really no longer has is a citation change.
  const source = join(root, "fixture-source");
  execFileSync("git", ["rm", "-q", "src/index.ts"], { cwd: source });
  execFileSync("git", ["commit", "-qm", "remove"], { cwd: source });
  const registry = join(root, "sources/repo/index.yaml");
  const parsed = YAML.parse(await readFile(registry, "utf8"));
  parsed.sources[0].modules[0].git.ref = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  await writeFile(registry, YAML.stringify(parsed));
  execFileSync("git", ["-C", join(root, "sources/repo/20260903/revision-fixture"), "fetch", "-q", "origin", parsed.sources[0].modules[0].git.ref]);
  const deleted = await codes();
  expect(deleted.map(issue => issue.code)).toContain("approved-source-region-changed");
  expect(deleted.find(issue => issue.code === "approved-source-region-changed")!.message).toContain("source-file-missing");
});
