import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withCommandReadCache } from "../project/commandReadCache.js";
import { countFiles } from "../project/statusReaders.js";
import { walkPackageFiles } from "../project/packageBuildReceipt.js";
import { readCandidateRecords, CANDIDATE_LEDGER_FILE } from "../project/candidateLedger.js";
import { prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { materializeProductionStage, productionStageDirectory, readProductionStage, saveProductionStage } from "../project/productionStageStore.js";
import { productionCapabilitiesSchema, productionTaskInput, validateProductionStage } from "../project/productionStage.js";

test("failed independent projection does not publish partially issued tasks", async () => {
  const parent = resolve(".tmp/projection-reuse-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-"));
  try {
    const scopes = [{ scope: "note:source", baseline: `sha256:${"a".repeat(64)}` }];
    const tasks = Array.from({ length: 12 }, (_, i) => {
      const task = { id: `task-${i}`, article_id: `article-${i}`, path: `architecture/page-${i}.md`,
        question: `Explain ${i}`, sources: scopes, base: null, batch: "batch", after: [], status: "pending" as const };
      return { ...task, input: productionTaskInput(task) };
    });
    const stage = validateProductionStage({ id: "stage", purpose: "Explain behavior", scopes,
      tasks, pending_scopes: [], report_approved: true });
    await saveProductionStage(root, stage);
    const blocked = join(root, productionStageDirectory(stage.id), "batches/batch/tasks/task-0/task.md");
    await mkdir(blocked, { recursive: true });
    const input = { projectRoot: root, stage, capabilities: productionCapabilitiesSchema.parse({}),
      materials: { requirements: "Explain behavior", sources: new Map([["note:source", "Read source"]]) } };
    await expect(materializeProductionStage(input)).rejects.toThrow();
    expect((await readProductionStage(root))!.tasks.every(task => task.status === "pending")).toBe(true);
    await rm(blocked, { recursive: true });
    await materializeProductionStage(input);
    expect((await readProductionStage(root))!.tasks.every(task => task.status === "issued")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("shared directory reads observe nested additions, removals and replacements", async () => {
  const parent = resolve(".tmp/directory-reuse-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-"));
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested/a.md"), "a");
    await withCommandReadCache(async () => {
      expect(await countFiles(root, () => true)).toBe(1);
      expect((await walkPackageFiles(root)).map(file => file.relPath)).toEqual(["nested/a.md"]);
      await writeFile(join(root, "nested/b.md"), "b");
      expect(await countFiles(root, () => true)).toBe(2);
      await rm(join(root, "nested/a.md"));
      expect((await walkPackageFiles(root)).map(file => file.relPath)).toEqual(["nested/b.md"]);
      await rename(join(root, "nested"), join(root, "moved"));
      expect((await walkPackageFiles(root)).map(file => file.relPath)).toEqual(["moved/b.md"]);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("candidate parse reuse isolates speculative edits and notices file replacement or corruption", async () => {
  const roots: string[] = [];
  try {
    const root = await prepareRevisionKnowledge(roots);
    const path = join(root, CANDIDATE_LEDGER_FILE);
    const original = await readFile(path, "utf8");
    await withCommandReadCache(async () => {
      const first = await readCandidateRecords(root);
      const body = first[0]!.body;
      first[0]!.body = "uncommitted";
      first[0]!.indexer_candidate.sections[0]!.markdown = "uncommitted";
      expect((await readCandidateRecords(root))[0]!.body).toBe(body);
      const changed = original.split("\n").filter(Boolean).slice(0, 1).join("\n") + "\n";
      await writeFile(`${path}.replacement`, changed);
      await rename(`${path}.replacement`, path);
      expect(await readCandidateRecords(root)).toHaveLength(1);
      await writeFile(path, "invalid\n");
      await expect(readCandidateRecords(root)).rejects.toThrow();
      await writeFile(path, original);
      expect(await readCandidateRecords(root)).toHaveLength(2);
      await rm(path);
      expect(await readCandidateRecords(root)).toEqual([]);
    });
  } finally { for (const root of roots) await rm(root, { recursive: true, force: true }); }
});
