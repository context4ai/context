import { loadSourcesRegistry } from "@c4a/context";
import { describe, expect, test } from "bun:test";
import { mkdirSync, unlinkSync } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ContextError } from "../lib/errors.js";
import { registerSourceBatch } from "../project/sourceBatchRegistration.js";
import { loadSourceBatchJournal, readSourceBatchJournalStatus } from "../project/sourceBatchJournal.js";
import { withSourceOperationRuntime } from "../project/sourceOperationRuntime.js";
import { withProjectWriteLock } from "../project/writeLock.js";
import { makeProjectRoot } from "./documentSourcesV062Helpers.js";

const namespace = "20260922";
const items = (count: number) => Array.from({ length: count }, (_, index) => ({
  type: "lark", module: `manual-${index}`, wikiToken: `fixture-token-${index}`,
}));

async function failureOf(action: Promise<unknown>): Promise<ContextError> {
  try { await action; } catch (error) {
    expect(error).toBeInstanceOf(ContextError);
    return error as ContextError;
  }
  throw new Error("expected registration to fail");
}

describe("source batch transaction compatibility", () => {
  test.each([100, 1000, 7000])("registers %i sources with the legacy receipt and no mandatory checkpoint", async (count) => {
    const root = await makeProjectRoot();
    try {
      // A runtime checkpoint path unavailable to new functionality must not
      // become a prerequisite for callers of the old command.
      await mkdir(join(root, ".tmp/context-runtime"), { recursive: true });
      await writeFile(join(root, ".tmp/context-runtime/source-batches"), "unavailable");
      const result = await registerSourceBatch({ projectRoot: root, namespace, payload: items(count) });
      expect(Object.keys(result).sort()).toEqual(["kind", "namespace", "registered", "total"]);
      expect(result.total).toBe(count);
      expect((await loadSourcesRegistry({ rootDir: root })).larks).toHaveLength(count);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 120_000);

  test("an invalid item commits only the valid prefix and reports its exact position", async () => {
    const root = await makeProjectRoot();
    try {
      const payload = [...items(2), { type: "lark", module: "invalid", wikiToken: "wiki", docToken: "doc" }, ...items(1).map(x => ({ ...x, module: "later" }))];
      const error = await failureOf(registerSourceBatch({ projectRoot: root, namespace, payload }));
      expect(error.detail?.failed_index).toBe(2);
      expect(error.detail?.batch_completed).toEqual([
        { type: "lark", module: "manual-0" }, { type: "lark", module: "manual-1" },
      ]);
      expect((await loadSourcesRegistry({ rootDir: root })).larks.map(x => x.name)).toEqual([
        `${namespace}/manual-0`, `${namespace}/manual-1`,
      ]);
      await expect(access(join(root, ".tmp/context-runtime/locks/project-write.lock"))).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("mixed file and Lark registrations preserve order and persist all valid items before a failure", async () => {
    const root = await makeProjectRoot();
    try {
      const result = await registerSourceBatch({ projectRoot: root, namespace, payload: [
        items(1)[0], { type: "file", module: "local-docs", local: "../docs" }, items(2)[1],
      ] });
      expect((result.registered as Array<{ type: string }>).map(x => x.type)).toEqual(["lark", "file", "lark"]);
      const registry = await loadSourcesRegistry({ rootDir: root });
      expect(registry.larks).toHaveLength(2);
      expect(registry.files).toHaveLength(1);
      const error = await failureOf(registerSourceBatch({ projectRoot: root, namespace, payload: [
        { type: "lark", module: "another", docToken: "another" },
        { type: "repo", module: "bad-repo", local: "missing-repo" },
      ] }));
      expect(error.detail?.failed_index).toBe(1);
      expect(error.detail?.batch_completed).toEqual([{ type: "lark", module: "another" }]);
      expect((await loadSourcesRegistry({ rootDir: root })).larks).toHaveLength(3);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("cancellation retains committed chunks and replay revalidates actual sources", async () => {
    const root = await makeProjectRoot();
    try {
      const controller = new AbortController();
      const error = await failureOf(registerSourceBatch({
        projectRoot: root, namespace, payload: items(250), checkpoint: true, signal: controller.signal,
        onProgress: value => { if (value.committed_count === 100) controller.abort(); },
      }));
      expect(error.detail?.reason_code).toBe("source-batch-interrupted");
      expect(error.detail?.batch_completed).toHaveLength(100);
      const checkpoint = error.detail?.checkpoint as { job_id: string };
      expect(await readSourceBatchJournalStatus({ projectRoot: root, jobId: checkpoint.job_id })).toMatchObject({
        phase: "interrupted", committed_count: 100, total: 250,
      });
      // A later authorized write can change already registered items. Replaying
      // the full input restores the requested value; skipping a cursor cannot.
      await registerSourceBatch({ projectRoot: root, namespace, payload: [
        { ...items(1)[0], wikiToken: "changed-by-another-command" },
      ] });
      const saved = await loadSourceBatchJournal({ projectRoot: root, jobId: checkpoint.job_id });
      const result = await registerSourceBatch({ projectRoot: root, namespace: saved.namespace, payload: saved.items, checkpoint: true });
      expect(result.total).toBe(250);
      const sources = (await loadSourcesRegistry({ rootDir: root })).larks;
      expect(sources).toHaveLength(250);
      expect(sources.find(x => x.module === "manual-0")?.wikiToken).toBe("fixture-token-0");
      expect(await readSourceBatchJournalStatus({ projectRoot: root, jobId: checkpoint.job_id })).toMatchObject({
        phase: "completed", committed_count: 250,
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("unavailable progress consumers and checkpoint updates do not turn successful writes into failures", async () => {
    const root = await makeProjectRoot();
    try {
      const first = await registerSourceBatch({ projectRoot: root, namespace, payload: items(101), checkpoint: true });
      const checkpoint = first.checkpoint as { state_path: string };
      let changed = false;
      const result = await registerSourceBatch({
        projectRoot: root, namespace, payload: items(101), checkpoint: true,
        onProgress(value) {
          if (!changed && value.committed_count === 100) {
            changed = true;
            unlinkSync(checkpoint.state_path);
            mkdirSync(checkpoint.state_path);
          }
          throw new Error("progress consumer unavailable");
        },
      });
      expect(result.total).toBe(101);
      expect(result.warnings).toHaveLength(1);
      expect((await loadSourcesRegistry({ rootDir: root })).larks).toHaveLength(101);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("an active writer rejects checkpoint registration without creating a second job", async () => {
    const root = await makeProjectRoot();
    try {
      let release!: () => void;
      let opened!: () => void;
      const acquired = new Promise<void>(resolve => { opened = resolve; });
      const writer = withProjectWriteLock(root, "test-owner", async () => {
        opened();
        await new Promise<void>(resolve => { release = resolve; });
      });
      await acquired;
      try {
        const error = await failureOf(registerSourceBatch({ projectRoot: root, namespace, payload: items(1), checkpoint: true }));
        expect(error.detail?.reason_code).toBe("project-write-in-progress");
        await expect(access(join(root, ".tmp/context-runtime/source-batches"))).rejects.toThrow();
      } finally { release(); await writer; }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("scoped SIGTERM cancellation closes the write lock and restores signal listeners", async () => {
    const root = await makeProjectRoot();
    const listeners = process.listenerCount("SIGTERM");
    let interrupted = false;
    try {
      const error = await failureOf(withSourceOperationRuntime(false, ({ signal }) => registerSourceBatch({
        projectRoot: root, namespace, payload: items(101), signal,
        onProgress(value) {
          if (!interrupted && value.phase === "running" && value.committed_count === 100) {
            interrupted = true;
            process.emit("SIGTERM");
          }
        },
      })));
      expect(error.detail?.reason_code).toBe("source-batch-interrupted");
      expect(process.listenerCount("SIGTERM")).toBe(listeners);
      await expect(access(join(root, ".tmp/context-runtime/locks/project-write.lock"))).rejects.toThrow();
      expect(JSON.parse(JSON.stringify(error.detail?.batch_completed))).toHaveLength(100);
      expect(await readFile(join(root, "sources/lark/index.yaml"), "utf8")).toContain("manual-99");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
