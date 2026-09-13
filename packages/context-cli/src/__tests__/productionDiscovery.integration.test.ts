import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { registerProjectIndexerCommands } from "../project/indexerCommands.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("catalog discovers readable skills outside a workspace without writing state", async () => {
  const parent = resolve(".tmp/production-discovery-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "catalog-")); roots.push(root);
  await writeFile(join(root, "marker.txt"), "unchanged\n");
  const before = await readdir(root);
  const result = JSON.parse(await runCliInDir(root, ["indexer", "catalog", "--format", "json"]));
  expect(result.skills.map((entry: { name: string }) => entry.name)).toEqual([
    "context-code-indexer", "context-markdown-indexer", "context-note-indexer", "context-sessions-indexer",
  ]);
  for (const skill of result.skills) {
    expect(Object.keys(skill).sort()).toEqual(["description", "entry", "name"]);
    expect((await readFile(skill.entry, "utf8")).trim().length).toBeGreaterThan(0);
  }
  expect(await readdir(root)).toEqual(before);
  expect(await readFile(join(root, "marker.txt"), "utf8")).toBe("unchanged\n");
});

test("Indexer commands cannot register skills, confirm version credentials or bypass current file actions", () => {
  const program = new Command();
  registerProjectIndexerCommands(program);
  const commands = program.commands.find(command => command.name() === "indexer")!.commands.map(command => command.name());
  // The standalone report remains available; it grants no production authority.
  expect(commands.sort()).toEqual(["catalog", "report-benchmark"]);
});

test("catalog rejects unsupported formats before discovery", async () => {
  const program = new Command().exitOverride();
  registerProjectIndexerCommands(program);
  await expect(program.parseAsync(["indexer", "catalog", "--format", "xml"], { from: "user" }))
    .rejects.toMatchObject({ detail: { flag: "--format" } });
});
