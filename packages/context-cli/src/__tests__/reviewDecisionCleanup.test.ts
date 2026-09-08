import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { clearCompletedLifecycle } from "../project/lifecycleCleanup.js";
import { readRejectedDecisions, LEGACY_REVIEW_DECISIONS_FILE } from "../project/reviewDecisions.js";

test("orphan legacy decisions do not influence a new task and disappear on lifecycle cleanup", async () => {
  const parent = resolve(import.meta.dir, "../../../.tmp/review-decision-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-"));
  try {
    await mkdir(join(root, "knowledge"));
    await writeFile(join(root, LEGACY_REVIEW_DECISIONS_FILE), "invalid historical record");
    await writeFile(join(root, "knowledge/page.md"), "approved");
    expect((await readRejectedDecisions(root)).size).toBe(0);
    await clearCompletedLifecycle(root);
    expect(await Bun.file(join(root, LEGACY_REVIEW_DECISIONS_FILE)).exists()).toBe(false);
    expect(await readFile(join(root, "knowledge/page.md"), "utf8")).toBe("approved");
    await clearCompletedLifecycle(root);
  } finally { await rm(root, { recursive: true, force: true }); }
});
