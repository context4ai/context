import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  loadSourceBatchJournal,
  prepareSourceBatchJournal,
  readSourceBatchJournalStatus,
  sourceBatchJournalReceipt,
  updateSourceBatchJournal,
} from "../project/sourceBatchJournal.js";

const roots: string[] = [];

async function fixture(): Promise<string> {
  const temporaryRoot = join(import.meta.dir, "../../../../.tmp/source-batch-journal-tests");
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(join(temporaryRoot, "workspace-"));
  roots.push(root);
  return root;
}

const items = [
  { type: "lark", module: "first", docToken: "private-document-token", title: "First document" },
  { type: "file", module: "second", local: "notes.md" },
];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("source batch checkpoint", () => {
  test("preserves normalized inputs with a deterministic namespace-aware ID and no configuration side effects", async () => {
    const projectRoot = await fixture();
    const initial = await prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items });
    const before = await readFile(initial.inputPath, "utf8");
    const same = await prepareSourceBatchJournal({
      projectRoot, namespace: "20260922",
      items: [{ title: "First document", docToken: "private-document-token", module: "first", type: "lark" }, items[1]],
    });
    expect(same.jobId).toBe(initial.jobId);
    expect(await readFile(initial.inputPath, "utf8")).toBe(before);
    const otherNamespace = await prepareSourceBatchJournal({ projectRoot, namespace: "20260923", items });
    expect(otherNamespace.jobId).not.toBe(initial.jobId);
    expect(initial.jobId).toMatch(/^[a-f0-9]{32}$/u);
    expect(initial.inputPath).toContain(join(".tmp", "context-runtime", "source-batches", initial.jobId));
    const loaded = await loadSourceBatchJournal({ projectRoot, jobId: initial.jobId });
    expect(loaded.items).toEqual(items);
    expect(loaded.namespace).toBe("20260922");
    expect(sourceBatchJournalReceipt(loaded)).toMatchObject({ registration_only: true, total: 2 });
    expect(loaded.resumeCommand).not.toContain("--configure");
  });

  test("status is compact and read-only, and completion replaces prior failure fields", async () => {
    const projectRoot = await fixture();
    const journal = await prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items });
    expect(await updateSourceBatchJournal(journal, { phase: "failed", committed_count: 1, failed_index: 1 })).toBeUndefined();
    const failed = await readSourceBatchJournalStatus({ projectRoot, jobId: journal.jobId });
    expect(failed).toMatchObject({ phase: "failed", committed_count: 1, failed_index: 1, total: 2, progress_is_advisory: true });
    const saved = await readFile(journal.statePath, "utf8");
    await readSourceBatchJournalStatus({ projectRoot, jobId: journal.jobId });
    expect(await readFile(journal.statePath, "utf8")).toBe(saved);
    expect(JSON.stringify(failed)).not.toContain("private-document-token");
    expect(JSON.stringify(failed)).not.toContain("First document");
    expect(await updateSourceBatchJournal(journal, { phase: "completed", committed_count: 2 })).toBeUndefined();
    const completed = await readSourceBatchJournalStatus({ projectRoot, jobId: journal.jobId });
    expect(completed).toMatchObject({ phase: "completed", committed_count: 2, pid: process.pid });
    expect(completed).not.toHaveProperty("failed_index");
  });

  test("resuming always returns every input even when progress says completed", async () => {
    const projectRoot = await fixture();
    const journal = await prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items });
    await updateSourceBatchJournal(journal, { phase: "completed", committed_count: 2 });
    const restored = await loadSourceBatchJournal({ projectRoot, jobId: journal.jobId });
    expect(restored.items).toEqual(items);
    expect(restored).not.toHaveProperty("committed_count");
    await prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items });
    expect(await readSourceBatchJournalStatus({ projectRoot, jobId: journal.jobId })).toMatchObject({ phase: "queued", committed_count: 0 });
  });

  test("rejects changed persisted inputs and never overwrites them on repeated initialization", async () => {
    const projectRoot = await fixture();
    const journal = await prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items });
    const stored = JSON.parse(await readFile(journal.inputPath, "utf8"));
    stored.items[0].title = "Changed after checkpoint creation";
    const tampered = JSON.stringify(stored);
    await writeFile(journal.inputPath, tampered);
    await expect(loadSourceBatchJournal({ projectRoot, jobId: journal.jobId })).rejects.toMatchObject({
      detail: { reason_code: "source-batch-input-changed" },
    });
    await expect(prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items })).rejects.toMatchObject({
      detail: { reason_code: "source-batch-input-changed" },
    });
    expect(await readFile(journal.inputPath, "utf8")).toBe(tampered);
  });

  test("rejects invalid schema and unsafe checkpoint IDs before accessing their paths", async () => {
    const projectRoot = await fixture();
    const journal = await prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items });
    const stored = JSON.parse(await readFile(journal.inputPath, "utf8"));
    stored.schema = "context.source-batch.input.v999";
    await writeFile(journal.inputPath, JSON.stringify(stored));
    await expect(loadSourceBatchJournal({ projectRoot, jobId: journal.jobId })).rejects.toMatchObject({
      detail: { reason_code: "source-batch-input-invalid" },
    });
    for (const jobId of ["../input", "/tmp/input", "a".repeat(31), "A".repeat(32), `${"a".repeat(32)}/../x`]) {
      await expect(loadSourceBatchJournal({ projectRoot, jobId })).rejects.toMatchObject({
        detail: { reason_code: "source-batch-id-invalid" },
      });
    }
  });

  test("invalid or missing progress cannot prevent a validated input from being resumed", async () => {
    const projectRoot = await fixture();
    const journal = await prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items });
    for (const invalid of ["not json", "null", JSON.stringify({ schema: "unknown", committed_count: 20000 })]) {
      await writeFile(journal.statePath, invalid);
      expect((await loadSourceBatchJournal({ projectRoot, jobId: journal.jobId })).items).toEqual(items);
      expect(await readSourceBatchJournalStatus({ projectRoot, jobId: journal.jobId })).toMatchObject({
        phase: "unknown", warnings: expect.any(Array),
      });
    }
    await rm(journal.statePath);
    expect((await loadSourceBatchJournal({ projectRoot, jobId: journal.jobId })).items).toEqual(items);
    expect(await readSourceBatchJournalStatus({ projectRoot, jobId: journal.jobId })).toMatchObject({ phase: "unknown" });
  });

  test("rejects progress for a different input and impossible progress counts", async () => {
    const projectRoot = await fixture();
    const journal = await prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items });
    const original = JSON.parse(await readFile(journal.statePath, "utf8"));
    for (const altered of [
      { ...original, input_digest: `sha256:${"0".repeat(64)}` },
      { ...original, committed_count: 3 },
      { ...original, phase: "completed", committed_count: 0 },
      { ...original, phase: "failed", failed_index: -1 },
    ]) {
      await writeFile(journal.statePath, JSON.stringify(altered));
      expect(await readSourceBatchJournalStatus({ projectRoot, jobId: journal.jobId })).toMatchObject({ phase: "unknown" });
    }
  });

  test("initial checkpoint failure rejects before registration while later progress failure is advisory", async () => {
    const projectRoot = await fixture();
    const journal = await prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items });
    await rm(journal.statePath);
    await mkdir(journal.statePath);
    await expect(prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items })).rejects.toMatchObject({
      detail: { reason_code: "source-batch-path-invalid" },
    });
    const warning = await updateSourceBatchJournal(journal, { phase: "completed", committed_count: 2 });
    expect(typeof warning).toBe("string");
    expect((await loadSourceBatchJournal({ projectRoot, jobId: journal.jobId })).items).toEqual(items);
    expect(warning).not.toContain("private-document-token");
  });

  test("blocks input symlinks and ancestor directory redirects without touching their targets", async () => {
    const projectRoot = await fixture();
    const journal = await prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items });
    const outside = await fixture();
    const target = join(outside, "untouched.json");
    await writeFile(target, "unchanged");
    await rm(journal.inputPath);
    await symlink(target, journal.inputPath);
    await expect(loadSourceBatchJournal({ projectRoot, jobId: journal.jobId })).rejects.toMatchObject({
      detail: { reason_code: "source-batch-path-invalid" },
    });
    await expect(prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items })).rejects.toMatchObject({
      detail: { reason_code: "source-batch-path-invalid" },
    });
    expect(await readFile(target, "utf8")).toBe("unchanged");
    await rm(dirname(journal.inputPath), { recursive: true });
    await symlink(outside, dirname(journal.inputPath));
    await expect(loadSourceBatchJournal({ projectRoot, jobId: journal.jobId })).rejects.toMatchObject({
      detail: { reason_code: "source-batch-path-invalid" },
    });
  });

  test("rejects empty, non-JSON and invalid namespace inputs without creating a runnable job", async () => {
    const projectRoot = await fixture();
    for (const namespace of ["../../outside", "20260230", "20261301", "2026092"]) {
      await expect(prepareSourceBatchJournal({ projectRoot, namespace, items })).rejects.toMatchObject({
        detail: { reason_code: "source-batch-input-invalid" },
      });
    }
    await expect(prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items: [] })).rejects.toMatchObject({
      detail: { reason_code: "source-batch-input-invalid" },
    });
    await expect(prepareSourceBatchJournal({ projectRoot, namespace: "20260922", items: [{ value: undefined }] })).rejects.toMatchObject({
      detail: { reason_code: "source-batch-input-invalid" },
    });
  });
});
