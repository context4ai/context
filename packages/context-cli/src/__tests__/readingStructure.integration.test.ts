import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptStructureDecision, readReadingStructure } from "../project/readingStructure.js";
import { adjustCurrentTaskSources } from "../project/taskSourceAdjustment.js";
import { recoverDurableMultiFileTransactions } from "../project/durableMultiFileTransaction.js";
import { withProjectWriteLock } from "../project/writeLock.js";

const update = { expected_revision: null, remove: [], upsert: [
  { key: "entry", parent: null, title: "Reader entry", order: 0, target: { artifact_ref: "artifact:approved-entry" } },
] };

test("structure approval and organization recover together after an interrupted transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "reading-transaction-"));
  const decisionPath = ".tmp/context-runtime/indexer/structure-review/current.json";
  try {
    await expect(acceptStructureDecision({ projectRoot: root, decisionPath, revision: "plan-1", reading_structure: update,
      inject_failure(point) { if (point === `after-target-rename:${decisionPath}`) throw new Error("interrupted"); },
    })).rejects.toThrow("interrupted");
    await withProjectWriteLock(root, "recover-test", () => recoverDurableMultiFileTransactions(root));
    expect(JSON.parse(await readFile(join(root, decisionPath), "utf8"))).toEqual({ revision: "plan-1", decision: "approved" });
    expect((await readReadingStructure(root))?.entries[0]?.target?.artifact_ref).toBe("artifact:approved-entry");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the existing task adjustment updates only organization and rejects stale concurrent edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "reading-adjustment-"));
  try {
    await mkdir(join(root, "knowledge"));
    await writeFile(join(root, "knowledge/entry.md"), "# Approved body\n");
    await adjustCurrentTaskSources(root, { reading_structure: update });
    const first = (await readReadingStructure(root))!;
    const next = { expected_revision: first.revision, upsert: [{ ...first.entries[0]!, title: "New reader label" }], remove: [] };
    expect(await adjustCurrentTaskSources(root, { reading_structure: next })).toMatchObject({ outcome: "reading-structure-updated" });
    expect(await readFile(join(root, "knowledge/entry.md"), "utf8")).toBe("# Approved body\n");
    await expect(adjustCurrentTaskSources(root, { reading_structure: next })).rejects.toThrow("reread");
    expect((await readReadingStructure(root))?.entries[0]?.title).toBe("New reader label");
  } finally { await rm(root, { recursive: true, force: true }); }
});
