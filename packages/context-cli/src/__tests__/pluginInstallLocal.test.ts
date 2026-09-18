import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { installLocalSkills } from "../project/pluginInstallLocal.js";
import { registerPluginCommands } from "../registerPluginCommands.js";
import { installAutoLocalSkills } from "../project/pluginInstallAuto.js";

let dir: string;
let source: string;
let target: string;
beforeEach(async () => {
  await mkdir(".tmp", { recursive: true });
  dir = await mkdtemp(".tmp/plugin-local-test-");
  source = join(dir, "bundle"); target = join(dir, "repo", ".agents");
  for (const name of ["context", "context-inspect-search", "context-code-indexer"]) {
    await mkdir(join(source, "skills", name, "references"), { recursive: true });
    await writeFile(join(source, "skills", name, "SKILL.md"), `---\nname: ${name}\n${name.endsWith("indexer") ? 'metadata:\n  context-public-entry: "false"\n' : ''}---\n`);
    await writeFile(join(source, "skills", name, "references", "guide.md"), "guide");
  }
  for (const host of ["claude", "cursor"]) {
    await mkdir(join(source, host, "commands"), { recursive: true });
    for (const name of ["context", "context-inspect-search"]) {
      await writeFile(join(source, host, "commands", `${host === "cursor" ? "c4a-" : ""}${name}.md`), `---\ndescription: ${name}\ndisable-model-invocation: true\n---\nCommand body\n`);
    }
  }
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("automatic mode installs detected hosts under the repository root", async () => {
  const repo = join(dir, "automatic");
  const output = await installAutoLocalSkills(source, repo, false, async agent => agent !== "codex");
  expect(output).toContain("claude, cursor");
  expect(existsSync(join(repo, ".claude/commands/context.md"))).toBe(true);
  expect(existsSync(join(repo, ".cursor/commands/c4a-context.md"))).toBe(true);
  expect(existsSync(join(repo, ".agents"))).toBe(false);
});

test("no host falls back only to .agents with a user hint; dry-run never writes", async () => {
  const repo = join(dir, "fallback");
  const output = await installAutoLocalSkills(source, repo, true, async () => false);
  expect(output).toContain("No supported host directory found");
  expect(existsSync(repo)).toBe(false);
  await installAutoLocalSkills(source, repo, false, async () => false);
  expect(existsSync(join(repo, ".agents/skills/context/SKILL.md"))).toBe(true);
  expect(existsSync(join(repo, ".claude"))).toBe(false);
  expect(existsSync(join(repo, ".cursor"))).toBe(false);
});

test("all hosts are preflighted before writes; Codex-only and blank path", async () => {
  const repo = join(dir, "preflight");
  await mkdir(join(repo, ".cursor/commands"), { recursive: true });
  await writeFile(join(repo, ".cursor/commands/c4a-context.md"), "mine");
  await expect(installAutoLocalSkills(source, repo, false, async () => true)).rejects.toThrow("conflict");
  expect(existsSync(join(repo, ".claude"))).toBe(false);
  await installAutoLocalSkills(source, repo, false, async agent => agent === "codex");
  expect(existsSync(join(repo, ".agents/skills/context/SKILL.md"))).toBe(true);
  expect(await readFile(join(repo, ".cursor/commands/c4a-context.md"), "utf8")).toBe("mine");
  await expect(installAutoLocalSkills(source, " ", true, async () => false)).rejects.toThrow("non-empty");
});

test("dry run is read-only; real install includes entries, providers and references", async () => {
  await installLocalSkills(source, target, true);
  expect(existsSync(target)).toBe(false);
  await installLocalSkills(source, target, false);
  expect(await readFile(join(target, "skills/context/references/guide.md"), "utf8")).toBe("guide");
  expect(existsSync(join(target, "skills/context-inspect-search/SKILL.md"))).toBe(true);
  expect(existsSync(join(target, "skills/context-code-indexer/SKILL.md"))).toBe(true);
});

test("refresh replaces managed contents and retains unrelated skills", async () => {
  await installLocalSkills(source, target, false);
  await mkdir(join(target, "skills/custom"));
  await writeFile(join(target, "skills/custom/SKILL.md"), "custom");
  await writeFile(join(source, "skills/context/SKILL.md"), "updated");
  await rm(join(source, "skills/context/references"), { recursive: true });
  await installLocalSkills(source, target, false);
  expect(await readFile(join(target, "skills/context/SKILL.md"), "utf8")).toBe("updated");
  expect(existsSync(join(target, "skills/context/references"))).toBe(false);
  expect(await readFile(join(target, "skills/custom/SKILL.md"), "utf8")).toBe("custom");
});

test("preflight protects unmanaged and customized skills before any update", async () => {
  await mkdir(join(target, "skills/context-code-indexer"), { recursive: true });
  await writeFile(join(target, "skills/context-code-indexer/SKILL.md"), "mine");
  await expect(installLocalSkills(source, target, false)).rejects.toThrow("conflict");
  expect(existsSync(join(target, "skills/context"))).toBe(false);
  await rm(target, { recursive: true });
  await installLocalSkills(source, target, false);
  await writeFile(join(target, "skills/context-code-indexer/SKILL.md"), "edited");
  await writeFile(join(source, "skills/context/SKILL.md"), "new");
  await expect(installLocalSkills(source, target, false)).rejects.toThrow("conflict");
  expect(await readFile(join(target, "skills/context/SKILL.md"), "utf8")).not.toBe("new");
});

test("rejects empty target and symlink destinations", async () => {
  await expect(installLocalSkills(source, " ", true)).rejects.toThrow("non-empty");
  await mkdir(join(dir, "other"));
  await mkdir(join(dir, "repo"));
  await symlink("../other", target);
  await expect(installLocalSkills(source, target, false)).rejects.toThrow("conflict");
});

test("local CLI requires a path and an explicit agent", async () => {
  const make = () => { const cmd = new Command().exitOverride().configureOutput({ writeErr: () => {} }); registerPluginCommands(cmd); return cmd; };
  await expect(make().parseAsync(["plugin", "install", "--local"], { from: "user" })).rejects.toThrow();
  await expect(make().parseAsync(["plugin", "install", "--local", target], { from: "user" })).rejects.toThrow("explicit --agent");
});

test("Claude installs command entries and hides internal skills without duplicate entry skills", async () => {
  await installLocalSkills(source, target, true, "claude");
  expect(existsSync(target)).toBe(false);
  await installLocalSkills(source, target, false, "claude");
  expect(existsSync(join(target, "skills/context"))).toBe(false);
  expect(existsSync(join(target, "skills/context-inspect-search"))).toBe(false);
  expect(await readFile(join(target, "commands/context.md"), "utf8")).toContain("Command body");
  expect(await readFile(join(target, "skills/context-code-indexer/SKILL.md"), "utf8")).toContain("user-invocable: false");
  await installLocalSkills(source, target, false, "claude");
});

test("Cursor uses bundled command names; Codex retains skill entries and metadata", async () => {
  await installLocalSkills(source, target, false, "cursor");
  expect(existsSync(join(target, "commands/c4a-context.md"))).toBe(true);
  expect(existsSync(join(target, "skills/context"))).toBe(false);
  const codex = join(dir, "codex");
  await mkdir(join(source, "skills/context/agents"));
  await writeFile(join(source, "skills/context/agents/openai.yaml"), "policy:\n  allow_implicit_invocation: false\n");
  await installLocalSkills(source, codex, false, "codex");
  expect(existsSync(join(codex, "commands"))).toBe(false);
  expect(await readFile(join(codex, "skills/context/agents/openai.yaml"), "utf8")).toContain("allow_implicit_invocation: false");
});

test("command conflicts are checked before writing skills, including edited commands and symlinks", async () => {
  await mkdir(join(target, "commands"), { recursive: true });
  await writeFile(join(target, "commands/context.md"), "mine");
  await expect(installLocalSkills(source, target, false, "claude")).rejects.toThrow("conflict");
  expect(existsSync(join(target, "skills"))).toBe(false);
  await rm(target, { recursive: true });
  await installLocalSkills(source, target, false, "claude");
  await writeFile(join(target, "commands/context.md"), "customized");
  await expect(installLocalSkills(source, target, false, "claude")).rejects.toThrow("conflict");
  await rm(join(target, "commands/context.md"));
  await symlink("context-inspect-search.md", join(target, "commands/context.md"));
  await expect(installLocalSkills(source, target, false, "claude")).rejects.toThrow("conflict");
});

test("host projection rejects existing duplicate skill entries instead of silently leaving both", async () => {
  await installLocalSkills(source, target, false);
  await expect(installLocalSkills(source, target, false, "claude")).rejects.toThrow("duplicate");
  expect(existsSync(join(target, "commands"))).toBe(false);
});

for (const agent of ["claude", "cursor", "codex"] as const) {
  test(`explicit ${agent} installs only its repository subdirectory without detection`, async () => {
    const repo = join(dir, "explicit");
    const detect = async (): Promise<boolean> => { throw new Error("Must not detect explicit target"); };
    await installAutoLocalSkills(source, repo, true, detect, agent);
    expect(existsSync(repo)).toBe(false);
    await installAutoLocalSkills(source, repo, false, detect, agent);
    const hosts = { claude: ".claude", cursor: ".cursor", codex: ".agents" };
    for (const host of ["claude", "cursor", "codex"] as const) {
      expect(existsSync(join(repo, hosts[host]))).toBe(host === agent);
    }
    expect(existsSync(join(repo, "commands"))).toBe(false);
    expect(existsSync(join(repo, "skills"))).toBe(false);
  });
}

test("all installs every host without detection", async () => {
  const repo = join(dir, "all");
  await installAutoLocalSkills(source, repo, false, async () => { throw new Error("no detection"); }, "all");
  for (const host of [".claude", ".cursor", ".agents"]) expect(existsSync(join(repo, host, "skills"))).toBe(true);
});

test("local-only agents are rejected for global installation", async () => {
  for (const agent of ["standalone", "auto-detect"]) {
    const cmd = new Command().exitOverride(); registerPluginCommands(cmd);
    await expect(cmd.parseAsync(["plugin", "install", "--agent", agent], { from: "user" })).rejects.toThrow("--agent must be");
  }
});

for (const hostDirs of [[], [".cursor"], [".claude", ".cursor"], [".agents"], [".claude", ".cursor", ".agents"]]) {
  test(`directory detection uses only repository entries: ${hostDirs.join(",") || "empty"}`, async () => {
    const repo = join(dir, "directory-detection");
    await mkdir(repo);
    for (const host of hostDirs) await mkdir(join(repo, host));
    await installAutoLocalSkills(source, repo, true);
    expect((await readdir(repo)).sort()).toEqual([...hostDirs].sort());
    await installAutoLocalSkills(source, repo, false);
    const expected = hostDirs.length ? hostDirs : [".agents"];
    expect((await readdir(repo)).sort()).toEqual([...expected].sort());
    for (const host of expected) expect(existsSync(join(repo, host, "skills/context-code-indexer/SKILL.md"))).toBe(true);
  });
}

test("directory detection rejects files and symlinks before writing", async () => {
  const repo = join(dir, "invalid-directory");
  await mkdir(repo);
  await writeFile(join(repo, ".cursor"), "not a directory");
  await expect(installAutoLocalSkills(source, repo, false)).rejects.toThrow("regular directory");
  expect(existsSync(join(repo, ".agents"))).toBe(false);
  await rm(join(repo, ".cursor"));
  await mkdir(join(dir, "external"));
  await symlink(join(process.cwd(), dir, "external"), join(repo, ".cursor"));
  await expect(installAutoLocalSkills(source, repo, false)).rejects.toThrow("regular directory");
  expect(existsSync(join(repo, ".agents"))).toBe(false);
});
