import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSourcesRegistry } from "@c4a/context";
import { parseDocumentSourceLocator } from "@c4a/extract";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { buildCommittedEvidenceIndex, readCommittedSnapshotMarkdown } from "../project/documentEvidenceIndex.js";
import { collectProjectStatus } from "../project/status.js";
import { readSourceStatus } from "../project/statusReaders.js";
import { resolveProjectIndexerMainSourceBinding } from "../project/indexerMainSourceAdapter.js";
import { inspectDocumentSources } from "../project/sourceDocumentStatus.js";
import { removeProjectSource } from "../project/sourceRemoval.js";
import { initContextProject } from "../project/workspace.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "context-managed-doc-")); roots.push(root);
  await initContextProject({ cwd: root, projectDir: "workspace", language: "en", dev: true });
  return join(root, "workspace");
}

test("note and sessions share direct readable storage, discovery and document evidence after cleanup", async () => {
  const root = await workspace();
  for (const type of ["note", "sessions"] as const) {
    const name = "20260907/变更说明.md";
    const input = { type, name, markdown: "# Change rationale\n\nA confirmed decision and its source.\n" };
    const saved = await importManagedDocument(root, input);
    expect(saved.outcome).toBe("saved");
    expect((await importManagedDocument(root, input)).outcome).toBe("unchanged");
    expect(await readdir(join(root, "sources", type))).toEqual(["20260907"]);
    expect(await readdir(join(root, "sources", type, "20260907"))).toEqual(["变更说明.md"]);
    await expect(importManagedDocument(root, { ...input, markdown: "# Different material" })).rejects.toThrow("already exists");
    const evidence = await buildCommittedEvidenceIndex({ projectRoot: root, sourceType: type, sourceName: name });
    expect(evidence.index.documents).toHaveLength(1);
    expect(evidence.index.documents[0]!.canonical_locator).toBe(`${type}:${name}`);
    expect(parseDocumentSourceLocator(`${type}:${name}`)).toMatchObject({ sourceType: type, sourceName: name, documentPath: "变更说明.md" });
    expect(await readCommittedSnapshotMarkdown({ projectRoot: root, index: evidence.index, path: "变更说明.md" })).toBe(input.markdown);
    const binding = await resolveProjectIndexerMainSourceBinding({ projectRoot: root,
      indexer_id: "notes", source_ref: `${type}:${name}`, module_ref: null, profile_contract_digest: `sha256:${"a".repeat(64)}` });
    expect(binding.adapter).toBe("captured-documents");
    await rm(join(root, ".tmp"), { recursive: true, force: true });
    const recovered = await buildCommittedEvidenceIndex({ projectRoot: root, sourceType: type, sourceName: name });
    expect(recovered.index.snapshot_hash).toBe(evidence.index.snapshot_hash);
    expect((await importManagedDocument(root, { ...input, markdown: "# Change rationale\n\nRevised confirmed detail.", base_digest: saved.digest })).outcome).toBe("saved");
  }
  const sources = await loadSourcesRegistry({ rootDir: root });
  expect(sources.notes).toHaveLength(1); expect(sources.sessions).toHaveLength(1);
  const status = await readSourceStatus(root);
  expect(status.diagnostics).toEqual([]);
  expect(status.documentSources).toEqual([]); // Only saved, never bound as an indexing target.
  expect(await readFile(join(root, "sources/note/20260907/变更说明.md"), "utf8")).toContain("Revised confirmed detail");
}, 30_000);

test("managed imports reject traversal and symlink storage without writing outside the workspace", async () => {
  const root = await workspace();
  await expect(importManagedDocument(root, { type: "note", name: "20260907/../../escape.md", markdown: "# unsafe" })).rejects.toThrow();
  await expect(importManagedDocument(root, { type: "note", name: "20260230/invalid.md", markdown: "# unsafe" })).rejects.toThrow();
  const outside = join(root, "external"); await mkdir(outside);
  await mkdir(join(root, "sources/note"), { recursive: true });
  await symlink(outside, join(root, "sources/note/20260907"));
  await expect(importManagedDocument(root, { type: "note", name: "20260907/escape.md", markdown: "# unsafe" })).rejects.toThrow("symlinks");
  expect(await readdir(outside)).toEqual([]);
}, 30_000);


test("managed source inspection and digest-bound removal preserve siblings and reject changed text or references", async () => {
  const root = await workspace();
  const name = "20260907/decision.md";
  const first = await importManagedDocument(root, { type: "note", name, markdown: "# Decision" });
  await importManagedDocument(root, { type: "sessions", name, markdown: "# Commit rationale" });
  expect(await inspectDocumentSources({ projectRoot: root, name: first.source_ref })).toMatchObject([
    { id: first.source_ref, status: "ready", content: first.path },
  ]);
  const old = await removeProjectSource({ projectRoot: root, selector: first.source_ref, apply: false });
  expect(old.registry).toBeNull();
  await importManagedDocument(root, { type: "note", name, markdown: "# New decision", base_digest: first.digest });
  await expect(removeProjectSource({ projectRoot: root, selector: first.source_ref, apply: true, planDigest: old.plan_digest })).rejects.toThrow("stale");
  await writeFile(join(root, "src/indexers.yaml"), `references: ["${first.source_ref}"]`);
  const blocked = await removeProjectSource({ projectRoot: root, selector: first.source_ref, apply: false });
  expect(blocked.references).toContain("src/indexers.yaml");
  await expect(removeProjectSource({ projectRoot: root, selector: first.source_ref, apply: true, planDigest: blocked.plan_digest })).rejects.toThrow("referenced");
  await rm(join(root, "src/indexers.yaml"));
  const plan = await removeProjectSource({ projectRoot: root, selector: first.source_ref, apply: false });
  expect((await removeProjectSource({ projectRoot: root, selector: first.source_ref, apply: true, planDigest: plan.plan_digest })).action).toBe("removed");
  expect((await loadSourcesRegistry({ rootDir: root })).notes).toEqual([]);
  expect(await readFile(join(root, "sources/sessions", name), "utf8")).toBe("# Commit rationale\n");
});


test("explicit managed rename synchronizes exact references and preserves source bytes and neighboring names", async () => {
  const { renameManagedDocument } = await import("../project/managedDocumentRename.js");
  const root = await workspace();
  const name = "20260907/decision.md";
  const saved = await importManagedDocument(root, { type: "note", name, markdown: "# Original decision" });
  await mkdir(join(root, "knowledge/guides"), { recursive: true });
  await writeFile(join(root, "knowledge/guides/guide.md"), `# Guide\n\nSource: ${saved.source_ref}#scope\n[Original](../../sources/note/${name}#scope)\nNeighbor: ${saved.source_ref}-other\n`);
  await writeFile(join(root, "knowledge/structure.yaml"), `views:\n  - path: guides/guide.md\n    sources: ["${saved.source_ref}"]\n`);
  await writeFile(join(root, "src/indexers.yaml"), `evidence: ["${saved.source_ref}"]\n`);
  await writeFile(join(root, "src/index.ts"), `import { source as inputSource } from "@c4a/context";\nconst value = inputSource("note", "${name}");\n`);
  const input = { projectRoot: root, source_ref: saved.source_ref, name: "20260907/confirmed-decision.md" };
  const plan = await renameManagedDocument(input);
  expect(plan.files.map((file) => file.path)).toContain("knowledge/guides/guide.md");
  await expect(renameManagedDocument({ ...input, apply: true, plan_digest: "stale" })).rejects.toThrow("stale");
  await renameManagedDocument({ ...input, apply: true, plan_digest: plan.plan_digest });
  expect(await readFile(join(root, "sources/note", input.name), "utf8")).toBe("# Original decision\n");
  expect((await loadSourcesRegistry({ rootDir: root })).notes.map((entry) => entry.name)).toEqual([input.name]);
  const page = await readFile(join(root, "knowledge/guides/guide.md"), "utf8");
  expect(page).toContain(`note:${input.name}#scope`);
  expect(page).toContain(`../../sources/note/${input.name}#scope`);
  expect(await readFile(join(root, "src/index.ts"), "utf8")).toContain(`inputSource("note", "${input.name}")`);
  expect(page).toContain(`${saved.source_ref}-other`);
  expect(await readFile(join(root, "src/indexers.yaml"), "utf8")).toContain(`note:${input.name}`);
});


test("batch import reports saved and rejected entries and a retry preserves accepted text", async () => {
  const root = await workspace();
  const { importSourceDocuments } = await import("../project/sourceDocumentImport.js");
  const first = { type: "note", name: "20260907/batch-note.md", markdown: "# Kept note" };
  const result = await importSourceDocuments(root, [first, { type: "sessions", name: "../invalid.md", markdown: "Invalid path" }]);
  expect(result).toMatchObject({ outcome: "partial", results: [{ index: 0, accepted: true }, { index: 1, accepted: false }] });
  expect(await importSourceDocuments(root, first)).toMatchObject({ outcome: "unchanged" });
  expect(await readFile(join(root, "sources/note/20260907/batch-note.md"), "utf8")).toBe("# Kept note\n");
});

test("sessions changes survive body edits, discovery, rename and runtime cleanup with digest-bound updates", async () => {
  const root = await workspace();
  const { renameManagedDocument } = await import("../project/managedDocumentRename.js");
  const { readSessionChanges } = await import("@c4a/context");
  const input = { type: "sessions", name: "20260907/design-choice.md", markdown: "# Design choice\n\nAn agreed constraint.",
    changes: [{ mr: "https://git.example.org/team/project/merge_requests/42" }, { repository: "team/project", commit: "b".repeat(40) }] };
  const saved = await importManagedDocument(root, input);
  expect((await importManagedDocument(root, input)).outcome).toBe("unchanged");
  expect((await loadSourcesRegistry({ rootDir: root })).sessions[0]?.changes).toEqual(input.changes);
  const { runCliInDir } = await import("./projectBuildVerifyV060Helpers.js");
  expect(JSON.parse(await runCliInDir(root, ["source", "get", saved.source_ref, "--format", "json"])).changes).toEqual(input.changes);
  expect(JSON.parse(await runCliInDir(root, ["source", "list", "--type", "sessions", "--format", "json"]))[0].changes).toEqual(input.changes);
  expect((await inspectDocumentSources({ projectRoot: root, name: saved.source_ref }))[0]?.changes).toEqual(input.changes);
  await expect(importManagedDocument(root, { ...input, changes: [] })).rejects.toThrow("base_digest");
  const revised = await importManagedDocument(root, { type: input.type, name: input.name, markdown: "# Revised summary", base_digest: saved.digest });
  expect(readSessionChanges(await readFile(join(root, saved.path), "utf8"))).toEqual(input.changes);
  const rename = { projectRoot: root, source_ref: saved.source_ref, name: "20260907/confirmed-choice.md" };
  const plan = await renameManagedDocument(rename);
  await renameManagedDocument({ ...rename, apply: true, plan_digest: plan.plan_digest });
  await rm(join(root, ".tmp"), { recursive: true, force: true });
  const discovered = (await loadSourcesRegistry({ rootDir: root })).sessions[0]!;
  expect(discovered).toMatchObject({ name: rename.name, changes: input.changes });
  const evidence = await buildCommittedEvidenceIndex({ projectRoot: root, sourceType: "sessions", sourceName: rename.name });
  const text = await readCommittedSnapshotMarkdown({ projectRoot: root, index: evidence.index, path: "confirmed-choice.md" });
  expect(readSessionChanges(text)).toEqual(input.changes);
  await importManagedDocument(root, { ...input, name: rename.name, markdown: "# Revised summary", changes: [], base_digest: revised.digest });
  expect((await loadSourcesRegistry({ rootDir: root })).sessions[0]?.changes).toBeUndefined();
  await expect(importManagedDocument(root, { ...input, type: "note" })).rejects.toThrow("only supported for sessions");
});

for (const type of ["note", "sessions"] as const) {
  test(`explicit ${type} source reaches initial requirements without indexing saved-only material`, async () => {
    const root = await workspace();
    const name = "20260908/selected.md";
    await importManagedDocument(root, { type, name, markdown: "# Selected source\n\nConfirmed input." });
    await importManagedDocument(root, { type, name: "20260908/saved-only.md", markdown: "# Saved only" });
    const saved = await collectProjectStatus(root);
    expect(saved.workflow.current?.node).toBe("choose-source-boundary");
    await writeFile(join(root, "src/index.ts"), [
      'import { defineProject, source } from "@c4a/context";',
      `export default defineProject({ sources: [source(${JSON.stringify(name)}, { type: ${JSON.stringify(type)} })], phases: [], packages: [] });`,
    ].join("\n"));
    for (const managed of [false, true]) {
      const selected = await collectProjectStatus(root, { managed });
      expect(selected.sourceCount).toBe(1);
      expect(selected.documentSources.map((source) => source.name)).toEqual([name]);
      expect(selected.workflow.current).toMatchObject({
        node: "run-indexer-lifecycle", configuration: { file: "src/indexers.yaml" },
      });
      expect(selected.workflow.current?.resources.required.map((resource) => resource.id))
        .toEqual(expect.arrayContaining(["context.indexer.provider-guide", "context.indexer.registry-bootstrap"]));
    }
    await writeFile(join(root, "src/index.ts"), `import { defineProject, allSources } from "@c4a/context";\nexport default defineProject({ sources: allSources(${JSON.stringify(type)}), phases: [], packages: [] });\n`);
    expect((await collectProjectStatus(root)).sourceCount).toBe(2);
    await writeFile(join(root, "src/index.ts"), 'import { defineProject } from "@c4a/context";\nexport default defineProject({ sources: [], phases: [], packages: [] });\n');
    expect((await collectProjectStatus(root)).workflow.current?.node).toBe("choose-source-boundary");
  });
}
