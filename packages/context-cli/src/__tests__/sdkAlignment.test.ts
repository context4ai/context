import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectSdkAlignment } from "../project/sdkAlignment.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function workspace(pinned: string, installed?: string) {
  const root = await mkdtemp(join(tmpdir(), "sdk-alignment-"));
  roots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { "@c4a/context": pinned } }));
  if (installed) {
    await mkdir(join(root, "node_modules", "@c4a", "context"), { recursive: true });
    await writeFile(join(root, "node_modules", "@c4a", "context", "package.json"), JSON.stringify({ version: installed }));
  }
  return root;
}

test("a workspace SDK pinned below the running CLI is reported with the upgrade instruction", async () => {
  const result = await inspectSdkAlignment(await workspace("0.7.100", "0.7.100"), "0.7.103");
  expect(result).toMatchObject({ workspace_sdk: { pinned: "0.7.100", installed: "0.7.100" }, cli: "0.7.103" });
  expect(result?.instruction).toContain("0.7.103");
  expect(result?.instruction).toContain("lock file");
});

test("an aligned workspace, a range, a local link or another major is not reported", async () => {
  expect(await inspectSdkAlignment(await workspace("0.7.103", "0.7.103"), "0.7.103")).toBeUndefined();
  expect(await inspectSdkAlignment(await workspace("^0.7.100"), "0.7.103")).toBeUndefined();
  expect(await inspectSdkAlignment(await workspace("file:../context"), "0.7.103")).toBeUndefined();
  expect(await inspectSdkAlignment(await workspace("1.0.0"), "0.7.103")).toBeUndefined();
});

test("a pinned version that was never installed is reported when the installed copy is older", async () => {
  expect(await inspectSdkAlignment(await workspace("0.7.103", "0.7.100"), "0.7.103")).toMatchObject({ workspace_sdk: { installed: "0.7.100" } });
});
