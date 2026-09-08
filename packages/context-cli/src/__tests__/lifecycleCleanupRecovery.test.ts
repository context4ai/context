import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clearCompletedLifecycle } from "../project/lifecycleCleanup.js";

test("cleanup failure retains the current task pointer until retry removes all artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-cleanup-recovery-"));
  const review = join(root, ".tmp/context-runtime/review");
  const current = join(root, ".tmp/context-runtime/indexer/candidate-compile/current.json");
  await mkdir(review, { recursive: true });
  await mkdir(join(current, ".."), { recursive: true });
  await writeFile(current, '{"task":"current"}\n');
  await writeFile(join(review, "decision.json"), "{}");
  await chmod(review, 0o500);
  try {
    await expect(clearCompletedLifecycle(root)).rejects.toBeDefined();
    expect(await readFile(current, "utf8")).toContain('"current"');
    await chmod(review, 0o700);
    await clearCompletedLifecycle(root);
    await expect(readFile(current)).rejects.toMatchObject({ code: "ENOENT" });
    await clearCompletedLifecycle(root);
  } finally {
    await chmod(review, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
