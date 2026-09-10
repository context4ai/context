import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reuseCommandFileRead, withCommandReadCache } from "../project/commandReadCache.js";

describe("command-local file reads", () => {
  test("approved structure reads isolate draft edits and observe committed replacement or removal", async () => {
    const { readKnowledgeStructure } = await import("../project/packageBuildInventory.js");
    const root = await mkdtemp(join(tmpdir(), "context-structure-cache-"));
    try {
      await mkdir(join(root, "knowledge"));
      const path = join(root, "knowledge/structure.yaml");
      await writeFile(path, "nodes: []\nviews: []\nedges: []\n");
      await withCommandReadCache(async () => {
        const first = await readKnowledgeStructure(root);
        first.parsed!.views = [{ path: "uncommitted.md" }];
        expect((await readKnowledgeStructure(root)).parsed!.views).toEqual([]);
        await writeFile(join(root, "replacement.yaml"), "nodes: []\nviews: [{path: committed.md}]\nedges: []\n");
        await rename(join(root, "replacement.yaml"), path);
        expect((await readKnowledgeStructure(root)).parsed!.views).toEqual([{ path: "committed.md" }]);
        await rm(path);
        expect((await readKnowledgeStructure(root)).parsed).toBeNull();
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("keeps a completed aggregate reusable when its many child reads exceed the cache bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-command-aggregate-"));
    try {
      const path = join(root, "source");
      await writeFile(path, "initial");
      let aggregates = 0;
      const read = () => reuseCommandFileRead({ key: "aggregate", paths: [path], read: async () => {
        aggregates++;
        return Promise.all(Array.from({ length: 80 }, (_, index) => reuseCommandFileRead({
          key: `child:${index}`, paths: [path], read: () => readFile(path, "utf8"),
        })));
      } });
      await withCommandReadCache(async () => {
        const first = await read();
        expect(await read()).toBe(first);
        expect(aggregates).toBe(1);
        await writeFile(path, "changed");
        expect((await read()).every(item => item === "changed")).toBe(true);
        expect(aggregates).toBe(2);
      });
      await withCommandReadCache(read);
      expect(aggregates).toBe(3);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

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
