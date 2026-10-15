import { expect, test } from "bun:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { prepareApprovedRevision, readApprovedRevision } from "../project/approvedRevision.js";
import { adjustCurrentTaskSources } from "../project/taskSourceAdjustment.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { collectProjectStatus } from "../project/status.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { currentScopeSourceVersion } from "../project/processedScopeStorage.js";
import { DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";

test("new evidence scope diagnostics identify the missing association without mutating revision or sources", async () => {
  const roots: string[] = [];
  try {
    const root = await initialRevisionKnowledge(roots);
    await prepareApprovedRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Add confirmed detail." });
    const note = await importManagedDocument(root, { type: "note", name: "20260917/new-evidence.md", markdown: "# Evidence\n\nConfirmed detail." });
    const before = (await readApprovedRevision(root))!;
    const config = join(root, "src/indexers.yaml");
    const registry = YAML.parse(await readFile(config, "utf8"));
    const owner = registry.requirements.find((r: { target_scope: { targets: { source_ref: string }[] } }) =>
      r.target_scope.targets.some(t => before.target.source_refs.includes(t.source_ref)));
    const approvedPath = join(root, "knowledge/architecture/overview.md");
    const approved = await readFile(approvedPath, "utf8");
    const noteBytes = await readFile(join(root, note.path), "utf8");
    const payload = { instruction: "Use independently recorded evidence.", scopes: [{ source_ref: note.source_ref, requirement_ref: owner.id }] };
    for (const [requirement, missing] of [[undefined, "requirement-ref"], ["unknown", "registered-requirement"], [owner.id, "new-source-association"]]) {
      await expect(adjustCurrentTaskSources(root, { ...payload, scopes: [{ source_ref: note.source_ref,
        ...(requirement === undefined ? {} : { requirement_ref: requirement }) }] })).rejects.toMatchObject({ detail: {
          reason_code: "revision-source-scope-unconfirmed", missing, source_ref: note.source_ref,
          configuration: { file: "src/indexers.yaml" }, input_schema: expect.any(Object),
          retained: { source_files: true, approved_pages: true, current_revision: true },
        } });
      expect(await readApprovedRevision(root)).toEqual(before);
    }
    registry.requirements.push({ id: "unrelated", purpose: "Independent task", target_scope: { targets: [{ source_ref: note.source_ref }] } });
    await writeFile(config, YAML.stringify(registry));
    await expect(adjustCurrentTaskSources(root, { ...payload, scopes: [{ source_ref: note.source_ref, requirement_ref: "unrelated" }] }))
      .rejects.toMatchObject({ detail: { missing: "current-task-association" } });
    owner.evidence_source_scope = { targets: [{ source_ref: note.source_ref }] };
    await writeFile(config, YAML.stringify(registry));
    await adjustCurrentTaskSources(root, payload);
    await adjustCurrentTaskSources(root, { ...payload, refresh: true });
    const after = (await readApprovedRevision(root))!;
    expect(after.target.source_refs).toContain(note.source_ref);
    expect(after.revision).not.toBe(before.revision);
    expect(await readFile(approvedPath, "utf8")).toBe(approved);
    expect(await readFile(join(root, note.path), "utf8")).toBe(noteBytes);
  } finally { for (const root of roots) await rm(root, { recursive: true, force: true }); }
}, 60_000);

test("evidence added during a queued revision stays citable by its later pages without discarding prepared ones", async () => {
  const roots: string[] = [];
  try {
    const root = await initialRevisionKnowledge(roots);
    const structurePath = join(root, "knowledge/structure.yaml");
    const structure = YAML.parse(await readFile(structurePath, "utf8"));
    structure.processed_scopes = [{ requirement_ref: "workspace-knowledge", source_ref: DOCUMENT_REVISION_SOURCE_REF,
      processed_version: await currentScopeSourceVersion(root, DOCUMENT_REVISION_SOURCE_REF) }];
    await writeFile(structurePath, YAML.stringify(structure));
    await prepareApprovedRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Add confirmed detail.",
      pending_targets: [{ path: "architecture/usage.md", instruction: "Add the same confirmed detail." }] });
    const note = await importManagedDocument(root, { type: "note", name: "20260917/new-evidence.md", markdown: "# Evidence\n\nConfirmed detail." });
    const config = join(root, "src/indexers.yaml");
    const registry = YAML.parse(await readFile(config, "utf8"));
    registry.requirements[0].evidence_source_scope = { targets: [{ source_ref: note.source_ref }] };
    await writeFile(config, YAML.stringify(registry));
    const payload = { instruction: "Use independently recorded evidence.", scopes: [{ source_ref: note.source_ref, requirement_ref: registry.requirements[0].id }] };
    await adjustCurrentTaskSources(root, payload);
    await adjustCurrentTaskSources(root, { ...payload, refresh: true });
    const first = (await readApprovedRevision(root))!;
    expect(first.pending_targets?.[0]?.supporting_sources).toContain(note.source_ref);
    const cite = (id: string) => [{ section_id: id, references: [
      { source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path: "src/index.ts", start_line: 1, end_line: 1 } },
      { source_ref: note.source_ref, locator: { path: "new-evidence.md", quote: "Confirmed detail." } }] }];
    const route = (await collectProjectStatus(root, { managed: true })).workflow.current!;
    await completeCurrentIndexerAction({ cwd: root, revision: route.revision, managed: true, value: { stage: "approved-revision",
      markdown: first.target.markdown.replace("value 42.", "value 42. Confirmed detail."), sections: cite("overview") } });
    const second = (await readApprovedRevision(root))!;
    expect(second.target.path).toBe("architecture/usage.md");
    expect(second.target.source_refs).toContain(note.source_ref);
    const prepared = await readCandidateRecords(root);
    expect(prepared).toHaveLength(1);
    await adjustCurrentTaskSources(root, payload);
    await adjustCurrentTaskSources(root, { ...payload, refresh: true });
    const again = (await readApprovedRevision(root))!;
    expect(again.batch_candidates?.map(item => item.candidate_id)).toEqual(prepared.map(item => item.candidate_id));
    expect(again.pending_targets ?? []).toHaveLength(0);
    expect(await readCandidateRecords(root)).toEqual(prepared);
    const repo = { instruction: "Cite the unchanged repository as well.", scopes: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF, requirement_ref: registry.requirements[0].id }] };
    await adjustCurrentTaskSources(root, repo);
    await adjustCurrentTaskSources(root, { ...repo, refresh: true });
    expect((await readApprovedRevision(root))!.batch_candidates?.map(item => item.candidate_id)).toEqual(prepared.map(item => item.candidate_id));
    expect(await readCandidateRecords(root)).toEqual(prepared);
  } finally { for (const root of roots) await rm(root, { recursive: true, force: true }); }
}, 60_000);
