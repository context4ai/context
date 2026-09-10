import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";

test("concurrent identical publications retain complete content without temporary collisions", async () => {
  const base = join(import.meta.dir, "../../../../.tmp/atomic-write");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "parallel-"));
  try {
    const path = join(root, "reading.md");
    await Promise.all(Array.from({ length: 32 }, () => atomicWriteFile(path, "# Complete reading\n")));
    expect(await readFile(path, "utf8")).toBe("# Complete reading\n");
    expect(await readdir(root)).toEqual(["reading.md"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
