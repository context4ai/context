import { expect, test } from "bun:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { prepareApprovedRevision, readApprovedRevision } from "../project/approvedRevision.js";
import { adjustCurrentTaskSources } from "../project/taskSourceAdjustment.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";

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
