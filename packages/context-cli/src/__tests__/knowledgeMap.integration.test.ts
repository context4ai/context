import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptStructureDecision, readKnowledgeMap } from "../project/knowledgeMap.js";
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
    await expect(acceptStructureDecision({ projectRoot: root, decisionPath, revision: "plan-1", knowledge_map: update,
      inject_failure(point) { if (point === `after-target-rename:${decisionPath}`) throw new Error("interrupted"); },
    })).rejects.toThrow("interrupted");
    await withProjectWriteLock(root, "recover-test", () => recoverDurableMultiFileTransactions(root));
    expect(JSON.parse(await readFile(join(root, decisionPath), "utf8"))).toEqual({ revision: "plan-1", decision: "approved" });
    expect((await readKnowledgeMap(root))?.entries[0]?.target?.artifact_ref).toBe("artifact:approved-entry");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the existing task adjustment updates only organization and rejects stale concurrent edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "reading-adjustment-"));
  try {
    await mkdir(join(root, "knowledge"));
    await writeFile(join(root, "knowledge/entry.md"), "---\nartifact_ref: artifact:approved-entry\n---\n# Approved body\n");
    await adjustCurrentTaskSources(root, { knowledge_map: update });
    const first = (await readKnowledgeMap(root))!;
    const next = { expected_revision: first.revision, upsert: [{ ...first.entries[0]!, title: "New reader label" }], remove: [] };
    expect(await adjustCurrentTaskSources(root, { knowledge_map: next })).toMatchObject({ outcome: "knowledge-map-updated" });
    expect(await readFile(join(root, "knowledge/entry.md"), "utf8")).toBe("---\nartifact_ref: artifact:approved-entry\n---\n# Approved body\n");
    await expect(adjustCurrentTaskSources(root, { knowledge_map: next })).rejects.toThrow("reread");
    expect((await readKnowledgeMap(root))?.entries[0]?.title).toBe("New reader label");
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("missing bindings reject approval before either decision or reading file is written", async () => {
  const root = await mkdtemp(join(tmpdir(), "reading-required-"));
  const decisionPath = ".tmp/context-runtime/indexer/structure-review/current.json";
  try {
    await expect(acceptStructureDecision({ projectRoot: root, decisionPath, revision: "plan-1",
      article_targets: [{ artifact_ref: "article:a", section_keys: [] }],
      knowledge_map: { expected_revision: null, upsert: [{ key: "group", title: "Guide", parent: null, order: 0 }], remove: [] },
    })).rejects.toMatchObject({ detail: { reason_code: "knowledge-map-incomplete", input_schema: { knowledge_map: { expected_revision: null } } } });
    expect(await readKnowledgeMap(root)).toBeUndefined();
    await expect(readFile(join(root, decisionPath))).rejects.toMatchObject({ code: "ENOENT" });
    await acceptStructureDecision({ projectRoot: root, decisionPath, revision: "plan-1",
      article_targets: [{ artifact_ref: "article:a", section_keys: [] }],
      knowledge_map: { expected_revision: null, upsert: [{ key: "a", title: "Guide", parent: null, order: 0, target: { artifact_ref: "article:a" } }], remove: [] } });
    expect((await readKnowledgeMap(root))?.entries[0]?.target?.artifact_ref).toBe("article:a");
  } finally { await rm(root, { recursive: true, force: true }); }
});
