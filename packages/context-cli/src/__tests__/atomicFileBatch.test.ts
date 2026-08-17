import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAtomicFileBatch } from "../lib/atomicFileBatch.js";

describe("atomic file batch", () => {
  test("replaces and removes a related file set together", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-atomic-files-"));
    try {
      const first = join(root, "snapshot.md");
      const second = join(root, "manifest.json");
      const stale = join(root, "stale.xml");
      await Promise.all([
        writeFile(first, "old snapshot"),
        writeFile(second, "old manifest"),
        writeFile(stale, "stale"),
      ]);

      await applyAtomicFileBatch({
        transactionRoot: join(root, ".tmp"),
        writes: [
          { path: first, bytes: "new snapshot" },
          { path: second, bytes: "new manifest" },
        ],
        removals: [stale],
      });

      expect(await readFile(first, "utf8")).toBe("new snapshot");
      expect(await readFile(second, "utf8")).toBe("new manifest");
      await expect(readFile(stale, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("restores every old file when a later target cannot be installed", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-atomic-files-"));
    try {
      const first = join(root, "a-snapshot.md");
      const stale = join(root, "b-stale.xml");
      const blockedParent = join(root, "z-blocked");
      await Promise.all([
        writeFile(first, "old snapshot"),
        writeFile(stale, "old evidence"),
        writeFile(blockedParent, "not a directory"),
      ]);

      await expect(applyAtomicFileBatch({
        transactionRoot: join(root, ".tmp"),
        writes: [
          { path: first, bytes: "new snapshot" },
          { path: join(blockedParent, "manifest.json"), bytes: "new manifest" },
        ],
        removals: [stale],
      })).rejects.toBeInstanceOf(Error);

      expect(await readFile(first, "utf8")).toBe("old snapshot");
      expect(await readFile(stale, "utf8")).toBe("old evidence");
      expect(await readFile(blockedParent, "utf8")).toBe("not a directory");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
