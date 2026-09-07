import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reuseCommandFileRead, withCommandReadCache } from "../project/commandReadCache.js";

describe("command-local file reads", () => {
  test("joins concurrent reads, notices writes/deletion, and never reuses across commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-command-read-"));
    try {
      const path = join(root, "state.json");
      await writeFile(path, "first");
      let reads = 0;
      const read = () => reuseCommandFileRead({ key: "fixture", paths: [path], read: async () => {
        reads++;
        return { content: await readFile(path, "utf8") };
      } });
      await withCommandReadCache(async () => {
        const [first, second] = await Promise.all([read(), read()]);
        expect(second).toBe(first);
        expect(reads).toBe(1);
        await withCommandReadCache(async () => { expect(await read()).toBe(first); });
        await writeFile(join(root, "new.json"), "other");
        await rename(join(root, "new.json"), path);
        expect(await read()).toEqual({ content: "other" });
        expect(reads).toBe(2);
        await rm(path);
        await expect(read()).rejects.toThrow();
        await writeFile(path, "third");
        expect(await read()).toEqual({ content: "third" });
        expect(reads).toBe(4);
      });
      await withCommandReadCache(read);
      expect(reads).toBe(5);
      await read();
      await read();
      expect(reads).toBe(7);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("does not cache a failed read when its file is unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-command-retry-"));
    try {
      const path = join(root, "source");
      await writeFile(path, "source");
      let tries = 0;
      await withCommandReadCache(async () => {
        const read = () => reuseCommandFileRead({ key: "retry", paths: [path], read: async () => {
          if (++tries === 1) throw new Error("retryable");
          return "recovered";
        } });
        await expect(read()).rejects.toThrow("retryable");
        expect(await read()).toBe("recovered");
        expect(await read()).toBe("recovered");
        expect(tries).toBe(2);
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
