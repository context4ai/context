import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, rm, cp, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import YAML from "yaml";
import { readProcessedScopes } from "@c4a/context";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { beginKnowledgeUpdate, readKnowledgeUpdate } from "../project/knowledgeUpdate.js";
import { readApprovedRevision, type ApprovedRevision } from "../project/approvedRevision.js";
import { collectProjectStatus } from "../project/status.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const scope = { requirement_ref: "workspace-knowledge", source_ref: DOCUMENT_REVISION_SOURCE_REF, module_refs: ["module:app"] };
const baseline = async (root: string) => readProcessedScopes(YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8")));

async function approveOne(root: string, path: string) {
  const all = await readCandidateRecords(root);
  const selected = all.find((item) => item.path === path)!;
  const rows = all.filter((item) => item.collection === selected.collection);
  const { applyReviewDecisions } = await import("../project/reviewApply.js");
  const { candidateIdsHash, candidateSetHash } = await import("../project/reviewShared.js");
  await applyReviewDecisions({ projectRoot: root, payload: { collection: selected.collection,
    scope: { kind: "collection", collection: selected.collection, count: rows.length,
      ids_sha256: candidateIdsHash(rows.map((item) => item.candidate_id).sort()), candidates_sha256: candidateSetHash(rows) },
    decisions: [{ candidate_id: selected.candidate_id, status: "approved" }] } });
}

async function initialKnowledge() {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"),
    join(root, "src/package-templates/kb"), { recursive: true });
  const entryPath = join(root, "src/index.ts");
  const entry = await readFile(entryPath, "utf8");
  await writeFile(entryPath, entry.replace("defineProject, source", "defineProject, kbPackage, source")
    .replace("packages: []", 'packages: [kbPackage({ name: "update-kb", template: { path: "src/package-templates/kb", vars: {} } })]'));
  await completePartitionStage(root);
  const structure = (await currentIndexerStructureReview(root))!;
  await completeCurrentIndexerAction({ cwd: root, revision: structure.revision, managed: true,
    value: { stage: "structure-review", decision: "approved" } });
  await completeAuthorStage(root);
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  await acceptStarterPackageTemplates({ projectRoot: root });
  await buildProjectPackages(root);
  return root;
}
async function complete(root: string, value: unknown) {
  const status = await collectProjectStatus(root, { managed: true });
  const route = status.workflow.current!;
  return completeCurrentIndexerAction({ cwd: root, revision: route.revision, managed: true, value });
}
async function commitSource(root: string, content = "export const answer = 43;\n") {
  const source = join(root, "fixture-source");
  await writeFile(join(source, "src/index.ts"), content);
  execFileSync("git", ["add", "src/index.ts"], { cwd: source });
  execFileSync("git", ["commit", "-qm", "change answer"], { cwd: source });
  const version = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  const registry = join(root, "sources/repo/index.yaml");
  const parsed = YAML.parse(await readFile(registry, "utf8"));
  parsed.sources[0].modules[0].git.ref = version;
  await writeFile(registry, YAML.stringify(parsed));
  return version;
}

test("source update preserves old baseline until every revised page is built and resumes after temporary loss", async () => {
  const root = await initialKnowledge();
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const first = (await readKnowledgeUpdate(root))!;
  expect(first.candidates).toHaveLength(2);
  await expect(beginKnowledgeUpdate(root, { scopes: [scope] })).rejects.toThrow("active task");
  await complete(root, { stage: "source-update", decisions: first.candidates.map(({ path }) => ({ path })),
    scope_summary: "Both published constants match the current source.", new_topics: [] });
  const before = await baseline(root);
  expect(before).toHaveLength(1);
  const version = await commitSource(root);
  await beginKnowledgeUpdate(root, { scopes: [scope], changes: "The answer changed; explain the relationship on both pages." });
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.previous_versions).toEqual([before[0]!.processed_version]);
  await complete(root, { stage: "source-update", decisions: update.candidates.map(({ path }) => ({ path, instruction: "Explain the changed answer." })),
    scope_summary: "Both pages explain the changed relationship.", new_topics: [] });
  const request = (await readApprovedRevision(root))!;
  await complete(root, { stage: "approved-revision", markdown: request.target.markdown.replace("public entry point", "updated public entry point") });
  const nextAuthor = (await readApprovedRevision(root))!;
  expect(nextAuthor.target.path).not.toBe(request.target.path);
  await complete(root, { stage: "approved-revision", markdown: nextAuthor.target.markdown.replace("public entry point", "updated public entry point") });
  expect(await readCandidateRecords(root)).toHaveLength(2);
  await approveOne(root, request.target.path);
  await expect(closeProjectWorkspace(root)).rejects.toThrow("draft candidates");
  expect(await baseline(root)).toEqual(before);
  await expect(buildProjectPackages(root)).rejects.toThrow();
  expect(await baseline(root)).toEqual(before);
  const completedPath = request.target.path;
  const completedBody = await readFile(join(root, "knowledge", completedPath), "utf8");
  expect((await readApprovedRevision(root))?.target.path).not.toBe(completedPath);
  await rm(join(root, ".tmp"), { recursive: true, force: true });
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const recovered = (await readKnowledgeUpdate(root))!;
  expect(recovered.previous_versions).toEqual(update.previous_versions);
  await complete(root, { stage: "source-update", decisions: recovered.candidates.map(({ path }) =>
    path === completedPath ? { path } : { path, instruction: "Explain the changed answer." }),
    scope_summary: "The first page already incorporates this change; finish the other page.", new_topics: [] });
  const last = (await readApprovedRevision(root))!;
  await complete(root, { stage: "approved-revision", markdown: last.target.markdown.replace("public entry point", "updated public entry point") });
  await approveCandidates(root, await readCandidateRecords(root)); await closeProjectWorkspace(root);
  expect(await baseline(root)).toEqual(before);
  await buildProjectPackages(root);
  expect((await baseline(root))[0]!.processed_version).toBe(version);
  const { compactApprovedKnowledgeMarkdown } = await import("../project/approvedKnowledgeMetadata.js");
  expect(await readFile(join(root, "knowledge", completedPath), "utf8")).toBe(compactApprovedKnowledgeMarkdown(completedBody));
  expect(await readApprovedRevision(root)).toBeUndefined();
}, 60_000);

test("a newly discovered topic uses the existing review writer and does not overwrite old pages", async () => {
  const root = await initialKnowledge();
  await beginKnowledgeUpdate(root, { scopes: [scope], changes: "A new reader task needs a separate guide." });
  const update = (await readKnowledgeUpdate(root))!;
  const oldPages = new Map(await Promise.all(update.candidates.map(async (candidate) =>
    [candidate.path, await readFile(join(root, "knowledge", candidate.path), "utf8")] as const)));
  await complete(root, { stage: "source-update", decisions: update.candidates.map(({ path }) => ({ path })),
    scope_summary: "Existing reference pages remain correct; add a guide for the combined task.",
    new_topics: [{ path: "architecture/combined-task.md", title: "Combined task", source_refs: [scope.source_ref],
      instruction: "Explain how the two existing constants are used together." }] });
  const pendingStructure = await readKnowledgeUpdate(root);
  expect(pendingStructure?.structure_proposal?.new_topics).toHaveLength(1);
  const ordinary = await collectProjectStatus(root);
  expect(ordinary.workflow.current?.gate?.id).toBe("indexer-semantic-structure-review");
  await complete(root, { stage: "structure-review", decision: "approved" });
  const request = (await readApprovedRevision(root))!;
  expect(request.target.base_digest).toBeNull();
  await complete(root, { stage: "approved-revision", markdown: request.target.markdown +
    `\n<!-- context:section id="usage" kind="content" source_ref="${scope.source_ref}" -->\n\nUse the two public constants together.\n\n<!-- /context:section -->\n` });
  expect(await baseline(root)).toEqual([]);
  await approveCandidates(root, await readCandidateRecords(root));
  try { await closeProjectWorkspace(root); } catch (error) { throw new Error(JSON.stringify(error)); }
  await buildProjectPackages(root);
  expect(await readFile(join(root, "knowledge/architecture/combined-task.md"), "utf8")).toContain("Use the two public constants together.");
  expect(await baseline(root)).toHaveLength(1);
  for (const [path, markdown] of oldPages) expect(await readFile(join(root, "knowledge", path), "utf8")).toBe(markdown);
}, 60_000);

test("late development context updates one code page without moving its code version or restarting Parser", async () => {
  const root = await initialKnowledge();
  const { importManagedDocument } = await import("../project/managedDocumentImport.js");
  const { currentLedger } = await import("../project/indexerMainRunStoreRecords.js");
  const note = await importManagedDocument(root, { type: "sessions", name: "20260907/constant-rationale.md",
    markdown: "# Constant rationale\n\nThe development discussion chose separate constants for separate callers. This describes intent, not a runtime guarantee." });
  const registryPath = join(root, "src/indexers.yaml");
  const registry = YAML.parse(await readFile(registryPath, "utf8"));
  registry.requirements[0].evidence_source_scope.targets.push({ source_ref: note.source_ref, module_refs: [] });
  registry.indexers[0].read_scope.refs.push("requirement:workspace-knowledge#evidence_source_scope");
  await writeFile(registryPath, YAML.stringify(registry));
  await beginKnowledgeUpdate(root, { scopes: [scope, { requirement_ref: scope.requirement_ref, source_ref: note.source_ref }] });
  const update = (await readKnowledgeUpdate(root))!;
  const target = update.candidates[0]!;
  const peer = update.candidates[1]!;
  const peerBody = await readFile(join(root, "knowledge", peer.path), "utf8");
  await complete(root, { stage: "source-update", scope_summary: "Code is unchanged; the new rationale clarifies only the first page.",
    decisions: [{ path: target.path, instruction: "Add the confirmed development rationale as intent, not behavior.", supporting_sources: [note.source_ref] }, { path: peer.path }], new_topics: [] });
  const request = (await readApprovedRevision(root))!;
  expect(request.target.source_refs).toContain(note.source_ref);
  const header = /^---\n([\s\S]*?)\n---\n/u.exec(request.target.markdown)!;
  const metadata = YAML.parse(header[1]!); metadata.sources = request.target.source_refs;
  const markdown = request.target.markdown.replace(header[0], `---\n${YAML.stringify(metadata)}---\n`) +
    `\n<!-- context:section id="rationale" kind="content" source_ref="${note.source_ref}" -->\n\nThe development discussion chose separate constants for separate callers. This is intent, not a runtime guarantee.\n\n<!-- /context:section -->\n`;
  await complete(root, { stage: "approved-revision", markdown });
  expect(await currentLedger(root)).toBeUndefined();
  await approveCandidates(root, await readCandidateRecords(root)); await closeProjectWorkspace(root); await buildProjectPackages(root);
  const processed = await baseline(root);
  expect(processed.find((item) => item.source_ref === scope.source_ref)?.processed_version).toBe(update.scopes[0]!.processed_version);
  expect(processed.find((item) => item.source_ref === note.source_ref)).toBeDefined();
  expect(await readFile(join(root, "knowledge", peer.path), "utf8")).toBe(peerBody);
  expect(await readFile(join(root, note.path), "utf8")).toContain("separate callers");
}, 60_000);


test("explicit rollback restores selected delivered bytes, discards drafts and keeps peers until build and cleanup finish", async () => {
  const { rollbackProjectTask, finishTaskRollback, readTaskRollback } = await import("../project/taskRollback.js");
  const { beginDocumentRevision } = await import("../project/documentRevision.js");
  const { durableContentDigest } = await import("../project/durableSingleFileTransaction.js");
  const root = await initialKnowledge();
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  const path = structure.views[0].path;
  const original = await readFile(join(root, "knowledge", path), "utf8");
  const peer = await readFile(join(root, "knowledge", structure.views[1].path), "utf8");
  await beginDocumentRevision({ projectRoot: root, selector: path, instruction: "Clarify the overview." });
  const revision = (await readApprovedRevision(root))!;
  await complete(root, { stage: "approved-revision", markdown: revision.target.markdown.replace(/(\n# [^\n]+)/u, "$1 clarified") });
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root); await buildProjectPackages(root);
  const changed = await readFile(join(root, "knowledge", path), "utf8");
  expect(changed).not.toBe(original);
  await beginDocumentRevision({ projectRoot: root, selector: path, instruction: "One more pending change." });
  const value = { summary: "Restore the overview and discard the unfinished follow-up; retain the other page.",
    discard_unfinished: true, files: [{ path: `knowledge/${path}`, base_digest: durableContentDigest(changed), content: original }] };
  const plan = await rollbackProjectTask({ projectRoot: root, value });
  expect(plan.action).toBe("preview");
  await rollbackProjectTask({ projectRoot: root, value, apply: true, plan_digest: plan.revision });
  expect((await rollbackProjectTask({ projectRoot: root, value, apply: true, plan_digest: plan.revision })).action).toBe("already-applied");
  expect(await readFile(join(root, "knowledge", path), "utf8")).toBe(original);
  expect(await readFile(join(root, "knowledge", structure.views[1].path), "utf8")).toBe(peer);
  await expect(beginKnowledgeUpdate(root, { scopes: [scope] })).rejects.toThrow("active task");
  await expect(finishTaskRollback(root)).rejects.toThrow("unfinished");
  expect((await collectProjectStatus(root, { managed: true })).workflow.current?.reason_code).toBe("route.rollback.close-required");
  await closeProjectWorkspace(root);
  await buildProjectPackages(root);
  expect(await readTaskRollback(root)).toBeDefined();
  expect((await collectProjectStatus(root, { managed: true })).workflow.current?.reason_code).toBe("route.rollback.cleanup-required");
  await finishTaskRollback(root);
  expect(await readTaskRollback(root)).toBeUndefined();
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  expect(await readKnowledgeUpdate(root)).toBeDefined();
}, 60_000);

test("explicit page move preserves its identity and updates incoming navigation through Review apply", async () => {
  const { beginDocumentRevision } = await import("../project/documentRevision.js");
  const { access } = await import("node:fs/promises");
  const root = await initialKnowledge();
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  const view = structure.views[0];
  const peerPath = structure.views[1].path;
  const originalPeer = await readFile(join(root, "knowledge", peerPath), "utf8");
  const { posix } = await import("node:path");
  const link = posix.relative(posix.dirname(peerPath), view.path);
  await writeFile(join(root, "knowledge", peerPath), `${originalPeer}\n[Related page](${link}#details)\n`);
  await closeProjectWorkspace(root); await buildProjectPackages(root);
  const nextPath = `${view.path.split("/")[0]}/reorganized/overview.md`;
  await beginDocumentRevision({ projectRoot: root, selector: view.path, instruction: "Move this page into the reorganized section, keeping its content.", move_to: nextPath });
  const request = (await readApprovedRevision(root))!;
  expect(request.target.previous_path).toBe(view.path);
  expect(request.target.path).toBe(nextPath);
  await complete(root, { stage: "approved-revision", markdown: request.target.markdown });
  const candidates = await readCandidateRecords(root);
  expect(candidates[0]!.view_ref).toBe(view.view_ref);
  await approveCandidates(root, candidates);
  await expect(access(join(root, "knowledge", view.path))).rejects.toThrow();
  expect(await readFile(join(root, "knowledge", peerPath), "utf8")).toContain(`](${posix.relative(posix.dirname(peerPath), nextPath)}#details)`);
  await closeProjectWorkspace(root); await buildProjectPackages(root);
  expect(await readApprovedRevision(root)).toBeUndefined();
  const after = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  expect(after.views.find((entry: { view_ref: string }) => entry.view_ref === view.view_ref).path).toBe(nextPath);
}, 60_000);

test("same-task input adjustment keeps the approved body and queued pages and rejects old completion", async () => {
  const root = await initialKnowledge();
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const update = (await readKnowledgeUpdate(root))!;
  await complete(root, { stage: "source-update", decisions: update.candidates.map(({ path }) => ({ path, instruction: "Explain the source change." })),
    scope_summary: "Inspect both related pages.", new_topics: [] });
  const old = (await readApprovedRevision(root))!;
  const { adjustCurrentTaskSources } = await import("../project/taskSourceAdjustment.js");
  const { completeApprovedRevision } = await import("../project/approvedRevision.js");
  const selection = { scopes: [{ source_ref: scope.source_ref, module_refs: scope.module_refs }], instruction: "Use the newly acquired fixed version." };
  await adjustCurrentTaskSources(root, selection);
  await expect(completeApprovedRevision({ projectRoot: root, revision: old.revision, markdown: old.target.markdown })).rejects.toThrow("adjusted source inputs");
  const version = await commitSource(root);
  await adjustCurrentTaskSources(root, { ...selection, refresh: true });
  const next = (await readApprovedRevision(root))!;
  expect(next.target.markdown).toBe(old.target.markdown);
  expect(next.pending_targets).toEqual(old.pending_targets);
  expect(next.processed_scopes?.[0]?.processed_version).toBe(version);
  expect(next.refresh_sources).toBeUndefined();
  await expect(completeApprovedRevision({ projectRoot: root, revision: old.revision, markdown: old.target.markdown })).rejects.toThrow("stale");
  expect(await baseline(root)).toEqual([]);
  const { importManagedDocument } = await import("../project/managedDocumentImport.js");
  const note = await importManagedDocument(root, { type: "note", name: "20260907/extra-context.md", markdown: "# Extra context\n\nKeep this confirmed explanation." });
  const registryPath = join(root, "src/indexers.yaml");
  const registry = YAML.parse(await readFile(registryPath, "utf8"));
  registry.requirements[0].evidence_source_scope.targets.push({ source_ref: note.source_ref, module_refs: [] });
  registry.indexers[0].read_scope.refs.push("requirement:workspace-knowledge#evidence_source_scope");
  await writeFile(registryPath, YAML.stringify(registry));
  const addition = { scopes: [{ source_ref: note.source_ref, requirement_ref: scope.requirement_ref }], instruction: "Use the extra confirmed explanation on the current page." };
  await adjustCurrentTaskSources(root, addition);
  await adjustCurrentTaskSources(root, { ...addition, refresh: true });
  const extended = (await readApprovedRevision(root))!;
  expect(extended.target.source_refs).toContain(note.source_ref);
  expect(extended.pending_targets).toEqual(old.pending_targets);
  expect(extended.processed_scopes).toHaveLength(2);
  expect(await baseline(root)).toEqual([]);

}, 20_000);


test("a newer same-task source revisits already delivered pages before advancing its scope", async () => {
  const root = await initialKnowledge();
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const update = (await readKnowledgeUpdate(root))!;
  await complete(root, { stage: "source-update", decisions: update.candidates.map(({ path }) => ({ path, instruction: "Refresh this explanation." })), scope_summary: "Both pages are affected.", new_topics: [] });
  const first = (await readApprovedRevision(root))!;
  await complete(root, { stage: "approved-revision", markdown: first.target.markdown.replace("public entry point", "updated public entry point") });
  const second = (await readApprovedRevision(root))!;
  await complete(root, { stage: "approved-revision", markdown: second.target.markdown.replace("public entry point", "updated public entry point") });
  await approveOne(root, first.target.path);
  await expect(closeProjectWorkspace(root)).rejects.toThrow("draft candidates");
  const saved = await readFile(join(root, "knowledge", first.target.path), "utf8");
  const { adjustCurrentTaskSources } = await import("../project/taskSourceAdjustment.js");
  const selection = { scopes: [{ source_ref: scope.source_ref }], instruction: "Recheck every affected explanation at the new version." };
  await adjustCurrentTaskSources(root, selection);
  await commitSource(root);
  await adjustCurrentTaskSources(root, { ...selection, refresh: true });
  const revised = (await readApprovedRevision(root))!;
  expect(revised.pending_targets?.some((item) => item.path === first.target.path)).toBe(true);
  expect(await readFile(join(root, "knowledge", first.target.path), "utf8")).toBe(saved);
  expect(await baseline(root)).toEqual([]);
}, 30_000);

test("Review rejection returns Author in both modes without a reset or repeated close", async () => {
  const root = await initialKnowledge();
  const { prepareApprovedRevision, APPROVED_REVISION_PATH } = await import("../project/approvedRevision.js");
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  await prepareApprovedRevision({ projectRoot: root, selector: structure.views[0].path, instruction: "Clarify the explanation." });
  const request = (await readApprovedRevision(root))!;
  await complete(root, { stage: "approved-revision", markdown: request.target.markdown.replace("public entry point", "updated public entry point") });
  const candidates = await readCandidateRecords(root);
  const { applyReviewDecisions } = await import("../project/reviewApply.js");
  const { candidateIdsHash, candidateSetHash } = await import("../project/reviewShared.js");
  await applyReviewDecisions({ projectRoot: root, payload: { collection: candidates[0]!.collection,
    scope: { kind: "collection", collection: candidates[0]!.collection, count: candidates.length,
      ids_sha256: candidateIdsHash(candidates.map((item) => item.candidate_id).sort()), candidates_sha256: candidateSetHash(candidates) },
    decisions: candidates.map((item) => ({ candidate_id: item.candidate_id, status: "rejected" as const })) } });
  const { readProjectIndexerCandidateCompileStatus } = await import("../project/indexerCandidateCompileActions.js");
  const state = await readProjectIndexerCandidateCompileStatus(root);
  expect(state.state).toBe("current"); expect(state.candidates[0]?.status).toBe("rejected");
  const saved = await readFile(join(root, APPROVED_REVISION_PATH), "utf8");
  for (const managed of [false, true]) {
    const status = await collectProjectStatus(root, { managed });
    const action = status.workflow.current?.action?.input as { stage: string; target: ApprovedRevision["target"]; instruction: string };
    expect(action.stage).toBe("approved-revision");
    expect(action.target.markdown).toBe(candidates[0]!.body);
    expect(action.instruction).toContain(request.instruction);
  }
  expect(await readFile(join(root, APPROVED_REVISION_PATH), "utf8")).toBe(saved);
  await complete(root, { stage: "approved-revision", markdown: candidates[0]!.body + "\nClarification requested during review.\n" });
  expect((await readCandidateRecords(root)).map((row) => row.status)).toEqual(["draft"]);
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root); await buildProjectPackages(root);
  expect(await readApprovedRevision(root)).toBeUndefined();
}, 30_000);


test("multiple revised pages share one Review close and build, including a rejected batch member", async () => {
  const root = await initialKnowledge();
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const update = (await readKnowledgeUpdate(root))!;
  await complete(root, { stage: "source-update", decisions: update.candidates.map(({ path }) => ({ path, instruction: "Clarify this explanation." })), scope_summary: "Both pages need clarification.", new_topics: [] });
  const first = (await readApprovedRevision(root))!;
  await complete(root, { stage: "approved-revision", markdown: first.target.markdown.replace("public entry point", "updated public entry point") });
  const second = (await readApprovedRevision(root))!;
  expect(second.target.path).not.toBe(first.target.path);
  expect(second.batch_candidates).toHaveLength(1);
  await complete(root, { stage: "approved-revision", markdown: second.target.markdown.replace("public entry point", "updated public entry point") });
  expect((await readApprovedRevision(root))?.review_ready).toBe(true);
  expect(await readCandidateRecords(root)).toHaveLength(2);
  const rows = await readCandidateRecords(root);
  const { applyReviewDecisions } = await import("../project/reviewApply.js");
  const { candidateIdsHash, candidateSetHash } = await import("../project/reviewShared.js");
  await applyReviewDecisions({ projectRoot: root, payload: { collection: rows[0]!.collection,
    scope: { kind: "collection", collection: rows[0]!.collection, count: rows.length,
      ids_sha256: candidateIdsHash(rows.map((item) => item.candidate_id).sort()), candidates_sha256: candidateSetHash(rows) },
    decisions: rows.map((item) => ({ candidate_id: item.candidate_id, status: item.path === first.target.path ? "approved" as const : "rejected" as const })) } });
  const firstApproved = await readFile(join(root, "knowledge", first.target.path), "utf8");
  const status = await collectProjectStatus(root, { managed: true });
  const reopened = status.workflow.current?.action?.input as { target: ApprovedRevision["target"] };
  expect(reopened.target.path).toBe(second.target.path);
  await complete(root, { stage: "approved-revision", markdown: reopened.target.markdown + "\nAdditional detail.\n" });
  expect(await readCandidateRecords(root)).toHaveLength(1);
  expect(await readFile(join(root, "knowledge", first.target.path), "utf8")).toBe(firstApproved);
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root); await buildProjectPackages(root);
  expect(await readApprovedRevision(root)).toBeUndefined();
  expect(await baseline(root)).toHaveLength(1);
}, 30_000);

test.each([false, true])("reopening a batch page retains the interrupted Author, including new pages (%s)", async (newPage) => {
  const root = await initialKnowledge();
  const version = await commitSource(root);
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const update = (await readKnowledgeUpdate(root))!;
  await complete(root, { stage: "source-update", decisions: update.candidates.map(({ path }, index) =>
    newPage && index ? { path } : { path, instruction: `Explain change for page ${index}.` }),
    scope_summary: "Update the affected explanations.", new_topics: newPage ? [{ path: "architecture/new-task.md", title: "New task",
      source_refs: [scope.source_ref], instruction: "Explain the new task." }] : [] });
  if (newPage) await complete(root, { stage: "structure-review", decision: "approved" });
  const first = (await readApprovedRevision(root))!;
  await complete(root, { stage: "approved-revision", markdown: first.target.markdown.replace("public entry point", "updated public entry point") });
  const interrupted = (await readApprovedRevision(root))!;
  const { reopenApprovedRevision } = await import("../project/approvedRevision.js");
  await reopenApprovedRevision({ projectRoot: root, selector: first.target.path, instruction: "Add the missing detail to the first page." });
  const reopened = (await readApprovedRevision(root))!;
  expect(reopened.pending_targets?.[0]).toMatchObject({ target: interrupted.target, instruction: interrupted.instruction });
  await complete(root, { stage: "approved-revision", markdown: reopened.target.markdown + "\nMissing detail.\n" });
  const resumed = (await readApprovedRevision(root))!;
  expect(resumed.target).toEqual(interrupted.target);
  expect(resumed.instruction).toBe(interrupted.instruction);
  expect(await baseline(root)).toEqual([]);
  const markdown = newPage ? resumed.target.markdown +
    `\n<!-- context:section id="usage" kind="content" source_ref="${scope.source_ref}" -->\n\nUse the changed constant for this task.\n\n<!-- /context:section -->\n`
    : resumed.target.markdown.replace("public entry point", "updated public entry point");
  await complete(root, { stage: "approved-revision", markdown });
  expect((await readCandidateRecords(root)).map((item) => item.path).sort()).toEqual([first.target.path, interrupted.target.path].sort());
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root); await buildProjectPackages(root);
  expect(await readFile(join(root, "knowledge", interrupted.target.path), "utf8")).toContain(newPage ? "Use the changed constant" : "updated public entry point");
  expect((await baseline(root))[0]?.processed_version).toBe(version);
  expect(await readApprovedRevision(root)).toBeUndefined();
}, 30_000);

test("an approved revision remains current after close relocates source images", async () => {
  const root = await initialKnowledge();
  const { createDocumentSnapshotManifest, computeDocumentContentHash } = await import("@c4a/extract");
  const { prepareApprovedRevision, completeApprovedRevision } = await import("../project/approvedRevision.js");
  const { readProjectIndexerCandidateCompileStatus } = await import("../project/indexerCandidateCompileActions.js");
  const sourceRoot = join(root, "sources/lark/20260907");
  const sourceRef = "lark:20260907/illustrated";
  const asset = "assets/illustrated/materialized/image/example.png";
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=", "base64");
  await mkdir(join(sourceRoot, dirname(asset)), { recursive: true });
  await writeFile(join(sourceRoot, asset), image);
  await writeFile(join(sourceRoot, "illustrated.md"), "# Illustrated\n");
  const manifest = createDocumentSnapshotManifest({ sourceType: "lark", sourceName: "20260907/illustrated", capturedAt: "2026-09-07T00:00:00.000Z",
    files: [{ path: "illustrated.md", bytes: "# Illustrated\n", title: "Illustrated" }],
    assets: [{ path: asset, content_hash: computeDocumentContentHash(image), media_type: "image/png", role: "evidence",
      source: { kind: "image", locator: "lark:image:illustrated" } }] });
  await writeFile(join(sourceRoot, "manifest.json"), JSON.stringify({ schema_version: "context.document-snapshot-batch.v1",
    source_type: "lark", batch: "20260907", sources: { illustrated: manifest } }));
  await writeFile(join(root, "sources/lark/index.yaml"), YAML.stringify({ sources: [{ name: "20260907",
    modules: [{ name: "illustrated", url: "https://example.test/docx/illustrated" }] }] }));
  const registryPath = join(root, "src/indexers.yaml");
  const registry = YAML.parse(await readFile(registryPath, "utf8"));
  registry.requirements[0].evidence_source_scope.targets.push({ source_ref: sourceRef, module_refs: [] });
  registry.indexers[0].read_scope.refs.push("requirement:workspace-knowledge#evidence_source_scope");
  await writeFile(registryPath, YAML.stringify(registry));
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  const { request } = await prepareApprovedRevision({ projectRoot: root, selector: structure.views[0].path,
    instruction: "Add the supplied illustration.", supporting_sources: [sourceRef] });
  const header = /^---\n([\s\S]*?)\n---\n/u.exec(request.target.markdown)!;
  const metadata = YAML.parse(header[1]!); metadata.sources = request.target.source_refs;
  const markdown = request.target.markdown.replace(header[0], `---\n${YAML.stringify(metadata)}---\n`) +
    `\n<!-- context:section id="illustration" kind="content" source_ref="${sourceRef}" -->\n\n![Example](${asset})\n\n<!-- /context:section -->\n`;
  await completeApprovedRevision({ projectRoot: root, revision: request.revision, markdown });
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  const pagePath = join(root, "knowledge", request.target.path);
  const applied = await readFile(pagePath, "utf8");
  expect(applied).toMatch(/assets\/image\/[a-f0-9]{64}\.png/u);
  expect((await readProjectIndexerCandidateCompileStatus(root)).state).toBe("current");
  await writeFile(pagePath, `${applied}\nUnrelated concurrent edit.\n`);
  expect((await readProjectIndexerCandidateCompileStatus(root)).state).toBe("stale");
  await writeFile(pagePath, applied);
  await buildProjectPackages(root);
  expect(await readApprovedRevision(root)).toBeUndefined();
}, 30_000);

test("revision Route includes selected Provider resources and expands current API tables", async () => {
  const root = await initialKnowledge();
  await commitSource(root, "export interface Options { label: string; count?: number }\nexport const answer = 43;\n");
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const update = (await readKnowledgeUpdate(root))!;
  await complete(root, { stage: "source-update", decisions: update.candidates.map(({ path }, index) => index ? { path } : { path, instruction: "Document the current Options fields." }), scope_summary: "Only the API explanation changes.", new_topics: [] });
  const request = (await readApprovedRevision(root))!;
  const status = await collectProjectStatus(root, { managed: true });
  const action = status.workflow.current?.action?.input as { writing_context: { providers: Array<{ resources: unknown[] }> } };
  expect(action.writing_context.providers.length).toBeGreaterThan(0);
  expect(action.writing_context.providers[0]!.resources.length).toBeGreaterThan(0);
  const block = request.program_blocks?.find((item) => item.markdown.includes("label") && item.markdown.includes("count"));
  expect(block).toBeDefined();
  const { expandRevisionProgramBlocks } = await import("../project/approvedRevisionPrograms.js");
  expect(() => expandRevisionProgramBlocks("{{context:program:foreign}}", request.program_blocks ?? [])).toThrow();
  await complete(root, { stage: "approved-revision", markdown: request.target.markdown +
    `\n<!-- context:section id="options" kind="content" source_ref="${scope.source_ref}" -->\n${block!.token}\n<!-- /context:section -->\n` });
  const candidates = await readCandidateRecords(root);
  expect(candidates[0]!.body).toContain(block!.markdown);
  expect(candidates[0]!.body).not.toContain(block!.token);
}, 30_000);
