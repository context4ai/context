import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedParserPreparation } from "../project/parserPreparationCache.js";
import { parserProgress } from "../project/parserProgress.js";

test("preparation checkpoint reuses completed work and rebuilds changed or corrupt input", async () => {
  const root = await mkdtemp(join(tmpdir(), "parser-checkpoint-"));
  let calls = 0;
  const run = (identity: string) => cachedParserPreparation({ projectRoot: root, slot: "source", identity,
    entryDigest: "entry", prepare: async () => { calls++; return { entry_digest: "entry", files: { "a.ts": "export const a = 1;" } }; } });
  try {
    expect(await run("revision-a")).toEqual(await run("revision-a"));
    expect(calls).toBe(1);
    await run("revision-b"); expect(calls).toBe(2);
    const dir = join(root, ".tmp/context-runtime/parser-preparations");
    const file = (await readdir(dir))[0]!;
    await writeFile(join(dir, file), "broken");
    await run("revision-b"); expect(calls).toBe(3);
    await expect(cachedParserPreparation({ projectRoot: root, slot: "source", identity: "failure", entryDigest: "entry",
      prepare: async () => { throw new Error("interrupted"); } })).rejects.toThrow("interrupted");
    await run("revision-b"); expect(calls).toBe(3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("progress has distinct stages and never needs a stdout writer", () => {
  const messages: string[] = [];
  const progress = parserProgress("source\nname", text => { messages.push(text); return true; });
  progress.update("12/20 files"); progress.close("failed");
  expect(messages.length).toBe(3);
  expect(messages.every(message => message.split("\n").length === 2)).toBe(true);
  expect(messages.at(-1)).toContain("failed");
});

test("an unavailable optional checkpoint does not block a successful preparation", async () => {
  const root = await mkdtemp(join(tmpdir(), "parser-checkpoint-unavailable-"));
  try {
    await mkdir(join(root, ".tmp/context-runtime"), { recursive: true });
    await writeFile(join(root, ".tmp/context-runtime/parser-preparations"), "not a directory");
    const value = await cachedParserPreparation({ projectRoot: root, slot: "source", identity: "current", entryDigest: "entry",
      prepare: async () => ({ entry_digest: "entry", files: { "a.ts": "export const a = 1;" } }) });
    expect(value.files["a.ts"]).toContain("export const a");
  } finally { await rm(root, { recursive: true, force: true }); }
});
