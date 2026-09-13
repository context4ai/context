import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { listProductionSkills } from "../project/productionSkillCatalog.js";
import { execFileSync } from "node:child_process";

test("skill discovery requires only entry metadata and never validates retired manifests", async () => {
  const parent = resolve(".tmp/production-skill-catalog-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-"));
  try {
    for (const name of ["notes", "code"]) {
      await mkdir(join(root, name));
      await writeFile(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: Investigate ${name} when selected\n---\nBody\n`);
    }
    await writeFile(join(root, "code/context-indexer.yaml"), "unavailable: [broken legacy manifest");
    const result = await listProductionSkills(root);
    expect(result.skills).toEqual(["code", "notes"].map(name => ({ name, description: `Investigate ${name} when selected`, entry: join(root, name, "SKILL.md") })));
    await writeFile(join(root, "code/SKILL.md"), "---\nname: code\n---\nNo description\n");
    await expect(listProductionSkills(root)).rejects.toThrow("name and description");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the actual catalog command exposes readable entries without Provider identity payloads", () => {
  const result = JSON.parse(execFileSync(process.execPath, [resolve(import.meta.dir, "../cli.ts"), "indexer", "catalog", "--format", "json"],
    { encoding: "utf8", timeout: 10000, env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" } }));
  expect(result.skills.map((skill: { name: string }) => skill.name)).toContain("context-code-indexer");
  for (const skill of result.skills) {
    expect(Object.keys(skill).sort()).toEqual(["description", "entry", "name"]);
    expect(skill.entry).toEndWith("/SKILL.md");
  }
});

test("an unavailable catalog identifies its file and recovery without requiring a workspace", async () => {
  const parent = resolve(".tmp/production-skill-catalog-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "missing-"));
  try {
    await mkdir(join(root, "incomplete"));
    await expect(listProductionSkills(root)).rejects.toMatchObject({ detail: {
      reason_code: "production-skill-catalog-unavailable", io_code: "ENOENT",
      file: join(root, "incomplete/SKILL.md"), next_action: { command: "context indexer catalog --format json" },
    } });
  } finally { await rm(root, { recursive: true, force: true }); }
});
