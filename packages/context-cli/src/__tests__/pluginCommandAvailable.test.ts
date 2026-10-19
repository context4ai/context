import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandAvailable } from "../project/pluginInstallTargets.js";

test("host discovery uses inherited PATH and treats command names literally", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-plugin-path-"));
  const previous = process.env.PATH;
  try {
    await writeFile(join(root, "context test host"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    process.env.PATH = `${root}:${previous ?? "/usr/bin:/bin"}`;
    expect(await commandAvailable("context test host")).toBe(true);
    expect(await commandAvailable("missing-host; true")).toBe(false);
  } finally {
    process.env.PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});
