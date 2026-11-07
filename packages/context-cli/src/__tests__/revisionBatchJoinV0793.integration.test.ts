import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { completeApprovedRevision, prepareApprovedRevision, readApprovedRevision } from "../project/approvedRevision.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { registerKnowledgeMaintenance } from "../project/knowledgeMaintenance.js";
import { readMaintenance } from "../project/maintenanceStorage.js";
import { joinableRevisionBatch } from "../project/revisionBatchJoin.js";
import { beginDocumentRevision } from "../project/documentRevision.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const maintain = (root: string, id: string, path: string, instruction: string) =>
  registerKnowledgeMaintenance(root, { id, operation: "revise", targets: [{ path, instruction }] });

test("maintenance joins an unapproved batch; a drafted page restarts from its draft; approval closes the batch", async () => {
  const root = await initialRevisionKnowledge(roots);
  const first = await prepareApprovedRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Clarify the answer." });
  // A queued sibling does not revoke the page being written.
  expect(await maintain(root, "usage-note", "architecture/usage.md", "Mention the usage note.")).toMatchObject({ outcome: "joined-current-batch",
    joined: [{ path: "architecture/usage.md", placement: "added-page" }] });
  let batch = (await readApprovedRevision(root))!;
  expect(batch.revision).toBe(first.revision);
  expect(batch.pending_targets?.map(item => item.path)).toEqual(["architecture/usage.md"]);
  expect((await readMaintenance(root))).toMatchObject({ pending: [], joined: [{ id: "usage-note" }] });
  expect(await maintain(root, "usage-note", "architecture/usage.md", "Mention the usage note.")).toMatchObject({ outcome: "already-joined" });

  // Draft the first page; the batch moves on to the joined page.
  const drafted = await completeApprovedRevision({ projectRoot: root, revision: batch.revision,
    markdown: batch.target.markdown.replace("value 42.", "value 42. Drafted clarification.") });
  batch = (await readApprovedRevision(root))!;
  expect(batch.target.path).toBe("architecture/usage.md");
  // More feedback on the drafted page: its Candidate ends, its text is the next starting point.
  expect(await maintain(root, "overview-more", "architecture/overview.md", "Also add an example.")).toMatchObject({
    joined: [{ path: "architecture/overview.md", placement: "reopened-draft" }] });
  batch = (await readApprovedRevision(root))!;
  expect((await readCandidateRecords(root)).some(row => row.candidate_id === drafted!.candidate_id)).toBe(false);
  const reopened = batch.pending_targets!.find(item => item.path === "architecture/overview.md")!;
  expect(reopened.target?.markdown).toContain("Drafted clarification.");
  expect(reopened.instruction).toContain("Also add an example.");

  // revise on a page outside the batch joins too, instead of failing as busy.
  expect(await beginDocumentRevision({ projectRoot: root, selector: "architecture/usage.md", instruction: "One more usage detail." }))
    .toMatchObject({ status: "author-reopened" });
  expect((await readApprovedRevision(root))!.instruction).toMatch(/Mention the usage note[\s\S]*One more usage detail/u);

  // Finish both pages and approve: the batch closes for joins.
  for (let page = 0; page < 2; page++) {
    const current = (await readApprovedRevision(root))!;
    await completeApprovedRevision({ projectRoot: root, revision: current.revision,
      markdown: current.target.markdown.replace("value 42.", `value 42. Final ${page}.`) });
  }
  await approveCandidates(root, await readCandidateRecords(root));
  expect(await joinableRevisionBatch(root)).toMatchObject({ joinable: false, reason: "batch-approved" });
  // A page of the approved batch cannot reopen it before delivery.
  await expect(beginDocumentRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Another change." }))
    .rejects.toMatchObject({ detail: { reason_code: "revision-batch-batch-approved" } });
  expect(await maintain(root, "after-approval", "architecture/usage.md", "Later change.")).toMatchObject({ outcome: "registered" });
  expect((await readMaintenance(root)).pending.map(item => item.input.id)).toEqual(["after-approval"]);
}, 120_000);

async function linkedKnowledge() {
  const { cp, readFile, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } = await import("./projectDocumentRevisionV074.fixture.js");
  const { produceFixtureArticles } = await import("./productionArticleWorkflow.fixture.js");
  const { closeProjectWorkspace } = await import("../project/close.js");
  const { acceptStarterPackageTemplates } = await import("../project/packageTemplateReview.js");
  const { buildFixturePackages } = await import("./workspaceVersionDelivery.fixture.js");
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
  const entryPath = join(root, "src/index.ts");
  await writeFile(entryPath, (await readFile(entryPath, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
    .replace("packages: []", 'packages: [kbPackage({ name: "update-kb", template: { path: "src/package-templates/kb", vars: {} } })]'));
  const body = (name: string) => name === "overview" ? "See the [legacy guide](legacy.md) for details." : `The ${name} page.`;
  await produceFixtureArticles(root, ["overview", "usage", "legacy"].map(name => ({
    path: `architecture/${name}.md`, question: `Explain the ${name}`, sources: [DOCUMENT_REVISION_SOURCE_REF],
    markdown: `---\ntitle: Answer ${name}\ndescription: The ${name} page.\n---\n\n<!-- context:section id="${name}" -->\n# Answer ${name}\n\nThe public entry point exports answer with value 42. ${body(name)}\n<!-- /context:section -->\n`,
    references: { sections: [{ id: name, references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path: "src/index.ts", start_line: 1, end_line: 1 } }] }] },
  })));
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  await acceptStarterPackageTemplates({ projectRoot: root });
  await buildFixturePackages(root);
  return root;
}

test("retirement inside a batch: linking pages join, the report shows the plan, delivery applies it with the final drafts", async () => {
  const { readFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { retireArticles } = await import("../project/articleRetirement.js");
  const { collectAllReviewCandidates, writeReviewHtml } = await import("../project/reviewHtml.js");
  const root = await linkedKnowledge();
  await prepareApprovedRevision({ projectRoot: root, selector: "architecture/usage.md", instruction: "Absorb the legacy guide." });
  const value = { reason: "Merged into usage", targets: [{ path: "architecture/legacy.md", replacement: "architecture/usage.md" }] };
  const preview = await retireArticles({ projectRoot: root, value }) as unknown as { revision: string; follow_up: { navigation: unknown[] } };
  expect(preview).toMatchObject({ action: "batch-preview", follow_up: { pages: ["architecture/overview.md"], translations: [] } });
  expect(preview.follow_up.navigation).toEqual([expect.objectContaining({ retired: "architecture/legacy.md", result: expect.stringContaining("keeps this label") })]);
  expect((preview.follow_up as unknown as { navigation_command: string }).navigation_command).toBe("context task adjust --inspect --format json");
  expect(existsSync(join(root, "knowledge/architecture/legacy.md"))).toBe(true);
  const scheduled = await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision }) as unknown as Record<string, unknown>;
  expect(scheduled).toMatchObject({ action: "scheduled", joined: [{ path: "architecture/overview.md", placement: "added-page" }] });
  expect(existsSync(join(root, "knowledge/architecture/legacy.md"))).toBe(true);
  expect((await readApprovedRevision(root))!.retirements).toEqual([value]);

  // Write usage, then overview while it still links to the retired page.
  let current = (await readApprovedRevision(root))!;
  await completeApprovedRevision({ projectRoot: root, revision: current.revision, markdown: current.target.markdown.replace("The usage page.", "The usage page, now with the legacy details.") });
  current = (await readApprovedRevision(root))!;
  expect(current.target.path).toBe("architecture/overview.md");
  await completeApprovedRevision({ projectRoot: root, revision: current.revision, markdown: current.target.markdown.replace("value 42.", "value 42. Revised.") });
  const report = await writeReviewHtml({ projectRoot: root, all: true });
  expect(report.retirement?.retired).toEqual([expect.objectContaining({ path: "architecture/legacy.md", replacement: "architecture/usage.md" })]);
  expect(report.retirement?.blockers.map(item => item.path)).toEqual(["knowledge/architecture/overview.md"]);
  expect(report.next_action?.command).toContain("context revise 'architecture/overview.md'");
  expect(report.navigation.changes.some(change => change.changes.includes("retargeted"))).toBe(true);
  await expect(approveCandidates(root, await readCandidateRecords(root))).rejects.toThrow("links to a page retired");
  expect(existsSync(join(root, "knowledge/architecture/legacy.md"))).toBe(true);

  // Fix the draft's link and text, then approve: one apply writes everything.
  await beginDocumentRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Point the link at the usage page." });
  current = (await readApprovedRevision(root))!;
  await completeApprovedRevision({ projectRoot: root, revision: current.revision,
    markdown: current.target.markdown.replace("See the [legacy guide](legacy.md) for details.", "See the [usage page](usage.md) for details.") });
  const after = await writeReviewHtml({ projectRoot: root, all: true });
  expect(after.retirement?.blockers).toEqual([]);
  expect((await collectAllReviewCandidates(root)).length).toBe(2);
  await approveCandidates(root, await readCandidateRecords(root));
  expect(existsSync(join(root, "knowledge/architecture/legacy.md"))).toBe(false);
  const structure = await readFile(join(root, "knowledge/structure.yaml"), "utf8");
  expect(structure).not.toContain("architecture/legacy.md");
  expect(await readFile(join(root, "knowledge/architecture/overview.md"), "utf8")).toContain("[usage page](usage.md)");
  const map = await readFile(join(root, "src/knowledge-map.yaml"), "utf8");
  expect(map).toContain("Answer legacy");

  // A mechanical correction after approval is recorded, not reviewed again.
  const { writeFile } = await import("node:fs/promises");
  const { recordMechanicalFix } = await import("../project/mechanicalFixes.js");
  const overviewPath = join(root, "knowledge/architecture/overview.md");
  await writeFile(overviewPath, (await readFile(overviewPath, "utf8")).replace("[usage page](usage.md)", "[usage guide](usage.md)"));
  // Without a record, final cleanup names the changed page and both ways forward.
  const { finishApprovedRevision } = await import("../project/approvedRevision.js");
  await expect(finishApprovedRevision(root)).rejects.toMatchObject({ detail: {
    reason_code: "revision-batch-page-changed-after-approval", pages: ["architecture/overview.md"] } });
  expect(await recordMechanicalFix(root, { path: "architecture/overview.md", reason: "Link text matches the replacement page title." }))
    .toMatchObject({ outcome: "recorded" });
  // Status sees the recorded fix as delivered, not as a concurrent edit to merge.
  const { approvedRevisionRecovery } = await import("../project/approvedRevisionRecovery.js");
  const { observeApprovedRevisionBatch } = await import("../project/approvedRevisionBatch.js");
  const { collectProjectStatus } = await import("../project/status.js");
  const open = (await readApprovedRevision(root))!;
  expect(await approvedRevisionRecovery(root, open)).toBeUndefined();
  expect((await observeApprovedRevisionBatch(root, open)).state).toBe("current");
  expect((await collectProjectStatus(root)).workflow.current?.node).not.toMatch(/recovery|merge/u);
  const { closeProjectWorkspace } = await import("../project/close.js");
  const { buildFixturePackages } = await import("./workspaceVersionDelivery.fixture.js");
  await closeProjectWorkspace(root);
  await buildFixturePackages(root);
  expect(await readApprovedRevision(root)).toBeUndefined();
  await expect(recordMechanicalFix(root, { path: "architecture/overview.md", reason: "Too late." })).rejects.toThrow("No approved batch");
}, 180_000);

test("maintenance queued while a source update is inspected joins the update's page batch", async () => {
  const { DOCUMENT_REVISION_SOURCE_REF } = await import("./projectDocumentRevisionV074.fixture.js");
  const { beginKnowledgeUpdate, readKnowledgeUpdate, completeKnowledgeUpdate } = await import("../project/knowledgeUpdate.js");
  const root = await initialRevisionKnowledge(roots);
  await beginKnowledgeUpdate(root, { scopes: [{ requirement_ref: "workspace-knowledge", source_ref: DOCUMENT_REVISION_SOURCE_REF, module_refs: ["module:app"] }] });
  expect(await maintain(root, "during-update", "architecture/usage.md", "Add the usage note.")).toMatchObject({ outcome: "registered" });
  const update = (await readKnowledgeUpdate(root))!;
  const pages = [...update.candidates.map(item => item.path), ...update.scope_pages ?? []];
  const result = await completeKnowledgeUpdate({ projectRoot: root, revision: update.revision, scope_summary: "Both pages follow the source.",
    new_topics: [], decisions: pages.filter(path => path === "architecture/overview.md").map(path => ({ path, instruction: "Explain the change." })) });
  expect(result).toMatchObject({ outcome: "revisions-prepared", joined_maintenance: ["during-update"] });
  const batch = (await readApprovedRevision(root))!;
  expect(batch.target.path).toBe("architecture/overview.md");
  expect(batch.pending_targets?.map(item => item.path)).toEqual(["architecture/usage.md"]);
  expect((await readMaintenance(root)).pending).toEqual([]);
}, 120_000);

test("a batch whose only page is submitted unchanged still delivers its scheduled retirement", async () => {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { retireArticles } = await import("../project/articleRetirement.js");
  const root = await linkedKnowledge();
  await prepareApprovedRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Absorb the usage page." });
  const value = { reason: "Merged into overview", targets: [{ path: "architecture/usage.md", replacement: "architecture/overview.md" }] };
  const preview = await retireArticles({ projectRoot: root, value }) as unknown as { revision: string; follow_up: { pages: string[] } };
  expect(preview.follow_up.pages).toEqual([]);
  await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision });
  const current = (await readApprovedRevision(root))!;
  expect(await completeApprovedRevision({ projectRoot: root, revision: current.revision, markdown: current.target.markdown })).toBeDefined();
  expect((await readApprovedRevision(root))?.retirements).toEqual([value]);
  await approveCandidates(root, await readCandidateRecords(root));
  expect(existsSync(join(root, "knowledge/architecture/usage.md"))).toBe(false);
}, 180_000);

test("rolling back a batch ends the maintenance requests that joined it", async () => {
  const { rollbackProjectTask } = await import("../project/taskRollback.js");
  const root = await initialRevisionKnowledge(roots);
  await prepareApprovedRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Clarify the answer." });
  expect(await maintain(root, "joined-then-rolled-back", "architecture/usage.md", "Add a note.")).toMatchObject({ outcome: "joined-current-batch" });
  const value = { summary: "Abandon this update", discard_unfinished: true as const, files: [] };
  const preview = await rollbackProjectTask({ projectRoot: root, value }) as { revision: string };
  await rollbackProjectTask({ projectRoot: root, value, apply: true, plan_digest: preview.revision });
  const state = await readMaintenance(root);
  expect(state.joined).toBeUndefined();
  expect(state.completed).toContainEqual(expect.objectContaining({ id: "joined-then-rolled-back", outcome: "cancelled" }));
  expect(await maintain(root, "joined-then-rolled-back", "architecture/usage.md", "Add a note.")).toMatchObject({ outcome: "already-cancelled" });
}, 120_000);

test("standalone retirement lists the same follow-up as a batch retirement", async () => {
  const { retireArticles } = await import("../project/articleRetirement.js");
  const root = await linkedKnowledge();
  const value = { reason: "Merged into usage", targets: [{ path: "architecture/legacy.md", replacement: "architecture/usage.md" }] };
  const preview = await retireArticles({ projectRoot: root, value }) as unknown as { action: string; revision: string;
    follow_up: { pages: string[]; navigation: Array<{ result: string }>; translations: string[] } };
  expect(preview.action).toBe("preview");
  expect(preview.follow_up.pages).toEqual(["architecture/overview.md"]);
  expect(preview.follow_up.navigation[0]?.result).toContain("keeps this label");
  const applied = await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision }) as unknown as { action: string; follow_up: unknown };
  expect(applied).toMatchObject({ action: "applied", follow_up: preview.follow_up });
}, 120_000);

test("task adjust completes in one call only when the added material is actually readable", async () => {
  const { readFile, rm: remove, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const YAML = (await import("yaml")).default;
  const { importManagedDocument } = await import("../project/managedDocumentImport.js");
  const { adjustCurrentTaskSources } = await import("../project/taskSourceAdjustment.js");
  const root = await initialRevisionKnowledge(roots);
  await prepareApprovedRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Add confirmed detail." });
  const note = await importManagedDocument(root, { type: "note", name: "20261107/evidence.md", markdown: "# Evidence\n\nConfirmed detail." });
  const config = join(root, "src/indexers.yaml");
  const registry = YAML.parse(await readFile(config, "utf8"));
  registry.requirements[0].evidence_source_scope = { targets: [{ source_ref: note.source_ref }] };
  await writeFile(config, YAML.stringify(registry));
  const payload = { instruction: "Use the recorded evidence.", scopes: [{ source_ref: note.source_ref, requirement_ref: registry.requirements[0].id }] };
  // The registration remains but the body is gone: acquisition is still needed.
  await remove(join(root, note.path));
  expect(await adjustCurrentTaskSources(root, payload)).toMatchObject({ action: "acquisition-authorized" });
}, 120_000);

test("a mechanical fix never stands in for a draft that Review did not approve", async () => {
  const { applyReviewDecisions } = await import("../project/reviewApply.js");
  const { candidateIdsHash, candidateSetHash } = await import("../project/reviewShared.js");
  const { recordMechanicalFix, recordedMechanicalFix } = await import("../project/mechanicalFixes.js");
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const root = await initialRevisionKnowledge(roots);
  await prepareApprovedRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Clarify.",
    pending_targets: [{ path: "architecture/usage.md", instruction: "Clarify usage." }] });
  for (let page = 0; page < 2; page++) {
    const current = (await readApprovedRevision(root))!;
    await completeApprovedRevision({ projectRoot: root, revision: current.revision, markdown: current.target.markdown.replace("value 42.", `value 42. Page ${page}.`) });
  }
  const rows = await readCandidateRecords(root);
  const overview = rows.find(row => row.path === "architecture/overview.md")!;
  const usage = rows.find(row => row.path === "architecture/usage.md")!;
  await applyReviewDecisions({ projectRoot: root, payload: { collection: overview.collection,
    scope: { kind: "collection", collection: overview.collection, count: rows.length,
      ids_sha256: candidateIdsHash(rows.map(row => row.candidate_id).sort()), candidates_sha256: candidateSetHash(rows) },
    decisions: [{ candidate_id: overview.candidate_id, status: "approved" }, { candidate_id: usage.candidate_id, status: "rejected" }] } });
  await expect(recordMechanicalFix(root, { path: "architecture/usage.md", reason: "Link text." }))
    .rejects.toMatchObject({ detail: { reason_code: "mechanical-fix-draft-not-approved" } });
  const batch = (await readApprovedRevision(root))!;
  const bytes = await readFile(join(root, "knowledge/architecture/usage.md"), "utf8");
  expect(await recordedMechanicalFix(root, batch, "architecture/usage.md", bytes)).toBe(false);
  // Even a record matching B's current bytes (written past the command) is not
  // accepted while B's own draft is unapproved.
  const { writeFile } = await import("node:fs/promises");
  const { MECHANICAL_FIXES_FILE } = await import("../project/mechanicalFixes.js");
  const { durableContentDigest } = await import("../project/durableSingleFileTransaction.js");
  const { approvedRevisionCandidateDelivered } = await import("../project/approvedRevisionBatch.js");
  expect(await recordMechanicalFix(root, { path: "architecture/overview.md", reason: "Link text." })).toMatchObject({ outcome: "recorded" });
  const record = JSON.parse(await readFile(join(root, MECHANICAL_FIXES_FILE), "utf8"));
  record.fixes.push({ path: "architecture/usage.md", reason: "Forged.", digest: durableContentDigest(bytes), recorded_at: new Date().toISOString() });
  await writeFile(join(root, MECHANICAL_FIXES_FILE), JSON.stringify(record));
  expect(await recordedMechanicalFix(root, batch, "architecture/usage.md", bytes)).toBe(false);
  const usageDraft = [...(batch.batch_candidates ?? []), ...(batch.candidate ? [batch.candidate] : [])].find(item => item.path === "architecture/usage.md")!;
  expect(await approvedRevisionCandidateDelivered(root, batch, usageDraft, bytes)).toBe(false);
}, 120_000);

test("a draft after an earlier partial delivery still repairs through revise", async () => {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { revisionStoragePath } = await import("../project/maintenanceStorage.js");
  const root = await initialRevisionKnowledge(roots);
  await prepareApprovedRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Clarify." });
  const current = (await readApprovedRevision(root))!;
  await completeApprovedRevision({ projectRoot: root, revision: current.revision, markdown: current.target.markdown.replace("value 42.", "value 42. Drafted.") });
  // build_pending marks an earlier delivered wave; this page's draft is still unreviewed.
  const path = join(root, await revisionStoragePath(root));
  await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")), build_pending: true }));
  expect(await beginDocumentRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Shorter, please." }))
    .toMatchObject({ status: "author-reopened" });
}, 120_000);

test("an interrupted rollback settles joined requests on retry", async () => {
  const { rollbackProjectTask } = await import("../project/taskRollback.js");
  const { saveMaintenance } = await import("../project/maintenanceStorage.js");
  const root = await initialRevisionKnowledge(roots);
  await prepareApprovedRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Clarify the answer." });
  await maintain(root, "joined-before-crash", "architecture/usage.md", "Add a note.");
  const value = { summary: "Abandon this update", discard_unfinished: true as const, files: [] };
  const preview = await rollbackProjectTask({ projectRoot: root, value }) as { revision: string };
  const saved = await readMaintenance(root);
  await rollbackProjectTask({ projectRoot: root, value, apply: true, plan_digest: preview.revision });
  // Simulate an exit after the rollback state was saved but before settlement.
  await saveMaintenance(root, { ...saved, completed: saved.completed });
  expect((await readMaintenance(root)).joined?.length).toBe(1);
  expect(await rollbackProjectTask({ projectRoot: root, value, apply: true, plan_digest: preview.revision })).toMatchObject({ action: "already-applied" });
  expect((await readMaintenance(root)).joined).toBeUndefined();
}, 120_000);
