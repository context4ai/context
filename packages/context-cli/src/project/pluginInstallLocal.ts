import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { PluginAgent } from "./pluginInstallTargets.js";

const MARKER = ".context-skill-install.json";

function conflict(path: string): never {
  throw new ContextError(ExitCode.UserError, `Local skill install conflict: ${path}`, {
    category: ErrorCategory.UserInputInvalid,
    next: "Choose another --local directory, or move conflicting/customized skills aside before retrying.",
  });
}

async function stat(path: string) {
  try { return await lstat(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function checkParents(path: string): Promise<void> {
  const entry = await stat(path);
  if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) conflict(path);
  const parent = dirname(path);
  if (parent !== path) await checkParents(parent);
}

async function digest(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(dir: string, prefix: string): Promise<void> {
    for (const name of (await readdir(dir)).sort()) {
      if (!prefix && name === MARKER) continue;
      const path = join(dir, name);
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) conflict(path);
      hash.update(JSON.stringify([prefix, name, entry.isDirectory()]));
      if (entry.isDirectory()) await visit(path, `${prefix}${name}/`);
      else if (entry.isFile()) hash.update(await readFile(path));
      else conflict(path);
    }
  }
  await visit(root, "");
  return hash.digest("hex");
}

/** Local host projection without registration, user configuration or global pruning. */
export async function installLocalSkills(root: string, path: string, dryRun: boolean, agent?: PluginAgent): Promise<string> {
  if (!path.trim()) conflict("--local requires a non-empty path");
  const targetRoot = resolve(path);
  const skillsRoot = join(targetRoot, "skills");
  await checkParents(skillsRoot);
  const sourceRoot = join(root, "skills");
  const commandPlans: Array<{ name: string; content: string; target: string; marker: string; hash: string }> = [];
  const commandEntries = new Set<string>();
  if (agent === "claude" || agent === "cursor") {
    // Claude command filenames use canonical skill slugs; Cursor files are prefixed.
    for (const name of await readdir(join(root, "claude", "commands"))) {
      if (name.endsWith(".md")) commandEntries.add(name.slice(0, -3));
    }
    const commandsRoot = join(targetRoot, "commands");
    await checkParents(commandsRoot);
    for (const entry of await readdir(join(root, agent, "commands"), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      let content = await readFile(join(root, agent, "commands", entry.name), "utf8");
      if (agent === "claude" && entry.name !== "context-plan.md") {
        const frontmatter = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(content);
        if (!frontmatter) conflict(join(root, agent, "commands", entry.name));
        content = `${frontmatter[1]}disable-model-invocation: true\n${frontmatter[2]!.replace(/^disable-model-invocation:.*\r?\n?/mu, "")}${frontmatter[3]}${content.slice(frontmatter[0].length)}`;
      }
      const target = join(commandsRoot, entry.name);
      const marker = join(commandsRoot, `.context-${entry.name}.json`);
      for (const file of [target, marker]) {
        const existing = await stat(file);
        if (existing && (!existing.isFile() || existing.isSymbolicLink())) conflict(file);
      }
      if (await stat(target)) {
        let previous: { owner?: string; digest?: string };
        try { previous = JSON.parse(await readFile(marker, "utf8")); } catch { conflict(target); }
        const current = createHash("sha256").update(await readFile(target)).digest("hex");
        if (previous?.owner !== "context-plugin-local" || previous.digest !== current) conflict(target);
      } else if (await stat(marker)) conflict(marker);
      commandPlans.push({ name: entry.name, target, marker, content, hash: createHash("sha256").update(content).digest("hex") });
    }
    if (!commandPlans.length) conflict(join(root, agent, "commands"));
  }
  const plans: Array<{ name: string; source: string; target: string; hash: string; exists: boolean }> = [];
  for (const entry of (await readdir(sourceRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !await stat(join(sourceRoot, entry.name, "SKILL.md"))) continue;
    const source = join(sourceRoot, entry.name);
    const target = join(skillsRoot, entry.name);
    if (commandEntries.has(entry.name) && entry.name !== "context-plan") {
      // Never leave a duplicate Skill entry alongside its slash command.
      if (await stat(target)) conflict(`${target} (use a fresh host directory to avoid duplicate command/skill entries)`);
      continue;
    }
    // Planning commands delegate to their Skill so bundled references remain
    // usable. Host projection hides its duplicate user command, not model use.
    const existing = await stat(target);
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) conflict(target);
      const markerPath = join(target, MARKER);
      if (!(await stat(markerPath))?.isFile()) conflict(target);
      let marker: { owner?: string; digest?: string };
      try { marker = JSON.parse(await readFile(markerPath, "utf8")); } catch { conflict(target); }
      if (marker?.owner !== "context-plugin-local" || marker.digest !== await digest(target)) conflict(target);
    }
    plans.push({ name: entry.name, source, target, hash: await digest(source), exists: !!existing });
  }
  if (!plans.length) conflict(sourceRoot);
  // Preflight every destination before touching any skill; retain unrelated skills.
  if (!dryRun) {
    await mkdir(skillsRoot, { recursive: true });
    for (const plan of plans) {
      const staging = await mkdtemp(join(skillsRoot, ".context-install-"));
      const candidate = join(staging, "candidate");
      const previous = join(staging, "previous");
      let moved = false;
      try {
        await cp(plan.source, candidate, { recursive: true });
        if (agent === "claude" || (agent === "cursor" && plan.name === "context-plan")) {
          const skillFile = join(candidate, "SKILL.md");
          const content = await readFile(skillFile, "utf8");
          const parts = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(content);
          if (parts && (plan.name === "context-plan" || /^\s*context-public-entry:\s*["']?false["']?\s*$/mu.test(parts[2]!))) {
            const frontmatter = parts[2]!.replace(/^user-invocable:.*\r?\n?/mu, "");
            await writeFile(skillFile, `${parts[1]}user-invocable: false\n${frontmatter}${parts[3]}${content.slice(parts[0].length)}`);
          }
        }
        await writeFile(join(candidate, MARKER), JSON.stringify({ owner: "context-plugin-local", digest: await digest(candidate) }) + "\n");
        if (plan.exists) { await rename(plan.target, previous); moved = true; }
        try { await rename(candidate, plan.target); }
        catch (error) { if (moved) await rename(previous, plan.target); throw error; }
        await rm(staging, { recursive: true, force: true });
      } catch (error) {
        // Retain staging/backup on failure for recovery instead of deleting evidence.
        throw new ContextError(ExitCode.WorkspaceStateError, `Local skill installation failed: ${plan.target}`, {
          category: ErrorCategory.WorkspaceStateInvalid,
          next: `Inspect ${staging} and retry --local after resolving the filesystem error.`,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const command of commandPlans) {
      await mkdir(dirname(command.target), { recursive: true });
      const staging = await mkdtemp(join(dirname(command.target), ".context-install-"));
      await writeFile(join(staging, "command"), command.content);
      await writeFile(join(staging, "marker"), JSON.stringify({ owner: "context-plugin-local", digest: command.hash }) + "\n");
      await rename(join(staging, "command"), command.target);
      await rename(join(staging, "marker"), command.marker);
      await rm(staging, { recursive: true, force: true });
    }
  }
  return formatFeedback({
    symbol: dryRun ? "·" : "✓", action: dryRun ? "planned" : "installed", subject: "local Context skills",
    headline: `${plans.length} skill(s), ${commandPlans.length} command(s) → ${targetRoot}`,
    body: ["Global agent configuration unchanged; local entries have no plugin namespace.",
      ...(agent === "codex" ? ["Codex uses skill entries, not a commands directory; bundled invocation policies are preserved."] : []),
      ...(agent === "cursor" ? ["Cursor command entries are separated; hiding Provider skills from its command menu is not guaranteed."] : []),
      ...plans.map(plan => `skills/${plan.name}`), ...commandPlans.map(plan => `commands/${plan.name}`)],
  });
}
