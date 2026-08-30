#!/usr/bin/env bun
/**
 * build-plugin.ts — materialize installable plugin trees from the root-level
 * plugins/context/ human source.
 *
 * The normal target is `dist/plugins` inside the @c4a/context-cli npm
 * package. `context plugin install` resolves that bundled directory at runtime
 * and installs it globally for Claude / Codex.
 * Source of truth:
 *   - plugins/context/skills/
 *   - plugins/context/.*-plugin/plugin.json.template
 *   - plugins/context/assets/ and README files
 *
 * Generated outputs under the target root:
 *   - claude/   — Claude plugin root containing only the public Context entry
 *   - codex/    — Codex plugin root containing only the public Context entry
 *   - cursor/   — Cursor plugin root containing only the public Context entry
 *   - skills/   — standalone Context and lifecycle Provider skills
 *
 * The same source also generates plugins/context/repo-install for direct Git
 * installation and repository-root marketplace manifests that point to it.
 */

import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const repoRoot = resolve(pkgRoot, "../..");
const PLUGIN_SOURCE_ROOT = resolve(repoRoot, "plugins", "context");
const PLUGINS_ROOT = resolve(pkgRoot, "dist", "plugins");
const REPO_INSTALL_ROOT = resolve(PLUGIN_SOURCE_ROOT, "repo-install");
const MARKETPLACE_NAME = "c4a";
const PLUGIN_NAME = "c4a";

interface CommandSource {
  slug: string;
  title: string;
  description: string;
  body: string;
}

function cursorCommandFileName(slug: string): string {
  return `c4a-${slug}.md`;
}

function rewriteClaudeSlashCommandsForCursor(body: string): string {
  return body
    .replace(/\/c4a:\*/g, "/c4a-*")
    .replace(/\/c4a:([a-z-]+)/g, (_match, slug: string) =>
      `/c4a-${slug}`
    )
    .replace(/^## Your [Tt]ask$/gm, "## Workflow")
    .replace(/\bnot a user slash command\b/g, "not a user command");
}

/**
 * Scan a generated build root for residual unresolved internal procedure
 * references in agent-facing entry files (Codex / Vercel public skills,
 * Cursor commands).
 *
 * Throws on any leak so future commands or rewrite-pattern gaps fail the
 * build instead of silently shipping unactionable verbs.
 */
async function verifyNoInternalProcedureReferenceLeak(root: string, label: string): Promise<void> {
  const offenders: string[] = [];
  const legacyProcedureTokenPattern = new RegExp("`context:" + "skill-[a-z-*]+`", "g");
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const content = await readFile(path, "utf8");
      const matches = [
        ...(content.match(/`skill-[a-z-*]+`/g) ?? []),
        ...(content.match(legacyProcedureTokenPattern) ?? []),
      ];
      if (matches && matches.length > 0) {
        offenders.push(`${path}: ${[...new Set(matches)].join(", ")}`);
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `${label} build contains internal procedure references in agent-facing entry files; public entries must consume workflow.current directly:\n${offenders.join("\n")}`,
    );
  }
}

/**
 * Scan a generated build root for residual `${CLAUDE_PLUGIN_ROOT}` tokens.
 * That token is Claude-specific and must not survive into Codex / Cursor /
 * Vercel-style builds — agents on those platforms cannot resolve it.
 */
async function verifyNoClaudePluginRootLeak(root: string, label: string): Promise<void> {
  const offenders: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const content = await readFile(path, "utf8");
      if (content.includes("${CLAUDE_PLUGIN_ROOT}")) {
        offenders.push(path);
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `${label} build contains \${CLAUDE_PLUGIN_ROOT} tokens — extend rewriteClaudePluginRoot() so non-Claude agents can resolve cross-skill paths:\n${offenders.join("\n")}`,
    );
  }
}

async function rewriteMarkdownFiles(root: string, rewrite: (content: string) => string): Promise<void> {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const original = await readFile(path, "utf8");
      const next = rewrite(original);
      if (next !== original) await writeFile(path, next, "utf8");
    }
  }
}


function generatedNotice(kind: string): string {
  return [
    `# Generated ${kind}`,
    "",
    "This directory is generated by `bun run build:plugin`.",
    "Do not edit files here directly.",
    "Edit `plugins/context/` and rerun the build instead.",
    "",
  ].join("\n");
}

function parseFrontmatter(markdown: string, fileName: string): { frontmatter: string; body: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error(`${fileName} must start with YAML frontmatter`);
  return {
    frontmatter: match[1] ?? "",
    body: markdown.slice(match[0].length).trimStart(),
  };
}

function frontmatterValue(frontmatter: string, key: string, fileName: string): string {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  if (!match?.[1]) throw new Error(`${fileName} must declare ${key}`);
  return match[1].replace(/^["']|["']$/g, "");
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const CURSOR_COMMAND_SUMMARIES: Record<string, string> = {
  context: "Start or continue a C4A Context knowledge workspace.",
};

function cursorCommandSummary(command: CommandSource): string {
  return CURSOR_COMMAND_SUMMARIES[command.slug] ?? command.description;
}

function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->\n*/g, "");
}

async function readCommands(): Promise<CommandSource[]> {
  const file = join(PLUGIN_SOURCE_ROOT, "skills", "context", "SKILL.md");
  const raw = await readFile(file, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw, file);
  return [{
    slug: "context",
    title: titleFromSlug("context"),
    description: frontmatterValue(frontmatter, "description", file),
    body,
  }];
}

async function renderManifest(input: {
  templatePath: string;
  outputPath: string;
  version: string;
  label: string;
}): Promise<Record<string, unknown>> {
  const template = await readFile(input.templatePath, "utf8");
  const rendered = template.replace(/__VERSION__/g, input.version);
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, rendered, "utf8");

  const parsed = JSON.parse(rendered) as Record<string, unknown>;
  if (parsed.name !== PLUGIN_NAME) {
    throw new Error(`${input.label} plugin.json name must be "${PLUGIN_NAME}", got "${String(parsed.name)}"`);
  }
  if (parsed.version !== input.version) {
    throw new Error(`${input.label} plugin.json version mismatch: ${String(parsed.version)} vs ${input.version}`);
  }
  return parsed;
}

async function resetDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

async function copyDir(from: string, to: string): Promise<void> {
  await cp(from, to, { recursive: true });
}

async function copyRuntimeAssets(outputRoot: string, names: readonly string[]): Promise<void> {
  const assetsRoot = join(PLUGIN_SOURCE_ROOT, "assets");
  const outputAssets = join(outputRoot, "assets");
  await rm(outputAssets, { recursive: true, force: true });
  for (const name of names) {
    const source = join(assetsRoot, name);
    if (await pathExists(source)) {
      await mkdir(outputAssets, { recursive: true });
      await copyFile(source, join(outputAssets, name));
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeGeneratedGuards(root: string, agentFile: "CLAUDE.md" | "AGENTS.md", label: string): Promise<void> {
  await writeFile(join(root, agentFile), generatedNotice(label), "utf8");
  await writeFile(join(root, "README.md"), generatedNotice(label), "utf8");
  await writeFile(join(root, ".generated"), "generated by packages/context-cli/scripts/build-plugin.ts\n", "utf8");
}

async function buildClaude(
  version: string,
  out = join(PLUGINS_ROOT, "claude"),
): Promise<void> {
  await resetDir(out);
  await renderManifest({
    label: "claude",
    version,
    templatePath: join(PLUGIN_SOURCE_ROOT, ".claude-plugin/plugin.json.template"),
    outputPath: join(out, ".claude-plugin/plugin.json"),
  });
  const commands = await readCommands();
  await writeClaudeCommands(out, commands);
  await writeGeneratedGuards(out, "CLAUDE.md", "Claude plugin build");
}

async function writeClaudeCommands(
  outputRoot: string,
  commands: readonly CommandSource[],
): Promise<void> {
  const commandsRoot = join(outputRoot, "commands");
  await mkdir(commandsRoot, { recursive: true });
  for (const command of commands) {
    const body = [
      "---",
      `description: ${JSON.stringify(command.description)}`,
      'argument-hint: "[project-dir or user intent]"',
      "allowed-tools: Bash(context:*), Bash(bun:*), Bash(cd *)",
      "---",
      "",
      command.body.trimEnd(),
      "",
    ].join("\n");
    await writeFile(join(commandsRoot, `${command.slug}.md`), body, "utf8");
  }
}

async function copyAllCanonicalSkills(outputRoot: string): Promise<void> {
  await copyDir(join(PLUGIN_SOURCE_ROOT, "skills"), join(outputRoot, "skills"));
}

async function copyContextEntrySkill(outputRoot: string): Promise<void> {
  await copyDir(
    join(PLUGIN_SOURCE_ROOT, "skills", "context"),
    join(outputRoot, "skills", "context"),
  );
}

async function buildCodex(
  version: string,
  commands: readonly CommandSource[],
  out = join(PLUGINS_ROOT, "codex"),
): Promise<void> {
  await resetDir(out);
  const manifest = await renderManifest({
    label: "codex",
    version,
    templatePath: join(PLUGIN_SOURCE_ROOT, ".codex-plugin/plugin.json.template"),
    outputPath: join(out, ".codex-plugin/plugin.json"),
  });
  if (manifest.skills !== "./skills/") {
    throw new Error(`codex plugin.json must point skills to "./skills/", got "${String(manifest.skills)}"`);
  }
  await copyRuntimeAssets(out, ["icon.svg", "logo.svg"]);
  await copyContextEntrySkill(out);
  await writeGeneratedGuards(out, "AGENTS.md", "Codex plugin build");
  await verifyNoInternalProcedureReferenceLeak(out, "codex");
  await verifyNoClaudePluginRootLeak(out, "codex");
}

async function buildVercel(commands: readonly CommandSource[]): Promise<void> {
  // Vercel-style standalone skills live directly under dist/plugins/skills/.
  // No plugin manifest, no per-build README; the top-level dist/plugins/README.md
  // owns onboarding for this install path.
  const skillsRoot = join(PLUGINS_ROOT, "skills");
  await resetDir(skillsRoot);
  await copyAllCanonicalSkills(PLUGINS_ROOT);
  await verifyNoInternalProcedureReferenceLeak(skillsRoot, "vercel");
  await verifyNoClaudePluginRootLeak(skillsRoot, "vercel");
}

async function writeCursorCommands(outRoot: string, commands: readonly CommandSource[]): Promise<void> {
  const dest = join(outRoot, "commands");
  await mkdir(dest, { recursive: true });
  for (const command of commands) {
    const rewrittenBody = rewriteClaudeSlashCommandsForCursor(command.body);
    const body = stripHtmlComments(rewrittenBody).trimStart();
    const file = `---\ndescription: ${JSON.stringify(command.description)}\n---\n\n${cursorCommandSummary(command)}\n\n---\n\n${body.trimEnd()}\n`;
    await writeFile(join(dest, cursorCommandFileName(command.slug)), file, "utf8");
  }
}

async function buildCursor(
  version: string,
  commands: readonly CommandSource[],
  out = join(PLUGINS_ROOT, "cursor"),
): Promise<void> {
  await resetDir(out);
  const manifest = await renderManifest({
    label: "cursor",
    version,
    templatePath: join(PLUGIN_SOURCE_ROOT, ".cursor-plugin/plugin.json.template"),
    outputPath: join(out, ".cursor-plugin/plugin.json"),
  });
  if (manifest.commands !== "./commands/") {
    throw new Error(`cursor plugin.json must point commands to "./commands/", got "${String(manifest.commands)}"`);
  }
  await copyRuntimeAssets(out, ["logo.svg"]);
  await writeCursorCommands(out, commands);
  await writeGeneratedGuards(out, "AGENTS.md", "Cursor plugin build");
  await writeFile(
    join(out, "README.md"),
    [
      generatedNotice("Cursor plugin build").trimEnd(),
      "",
      "Install shape:",
      "",
      "- Marketplace/GitHub plugin shape: this directory is a plugin root with `.cursor-plugin/plugin.json` and `commands/`.",
      "- The public entry is under `commands/`; Cursor command files are prefixed as `c4a-*` to avoid global slash-command collisions.",
      "- Lifecycle Provider skills are installed separately into the shared user skill directory by `context plugin install`.",
      "- Local plugin fallback: symlink or copy this directory to `~/.cursor/plugins/local/c4a/` only when Marketplace import is unavailable.",
      "",
      "Cursor Marketplace installs this plugin root directly.",
      "",
    ].join("\n"),
    "utf8",
  );
  await rewriteMarkdownFiles(out, rewriteClaudeSlashCommandsForCursor);
  await verifyNoInternalProcedureReferenceLeak(out, "cursor");
  await verifyNoClaudePluginRootLeak(out, "cursor");
}

async function writeMarketplaceManifests(version: string): Promise<void> {
  const claudeMarketplace = {
    name: MARKETPLACE_NAME,
    owner: { name: "c4a" },
    plugins: [{
      name: PLUGIN_NAME,
      source: "./claude",
      description: "Start or continue a local knowledge workspace through one graph-routed entry.",
    }],
  };
  const cursorMarketplace = {
    name: MARKETPLACE_NAME,
    owner: { name: "Context4AI", email: "support@context4ai.dev" },
    metadata: { description: "C4A Context plugin marketplace" },
    plugins: [{
      name: PLUGIN_NAME,
      source: "./cursor",
      description: "Start or continue a project-local knowledge workspace through one graph-routed entry.",
    }],
  };
  const codexMarketplace = {
    name: MARKETPLACE_NAME,
    interface: { displayName: "C4A Marketplace" },
    plugins: [{
      name: PLUGIN_NAME,
      source: { source: "local", path: "./codex" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    }],
  };
  await mkdir(join(PLUGINS_ROOT, ".claude-plugin"), { recursive: true });
  await mkdir(join(PLUGINS_ROOT, ".cursor-plugin"), { recursive: true });
  await mkdir(join(PLUGINS_ROOT, ".agents", "plugins"), { recursive: true });
  await writeFile(
    join(PLUGINS_ROOT, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify(claudeMarketplace, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(PLUGINS_ROOT, ".cursor-plugin", "marketplace.json"),
    `${JSON.stringify(cursorMarketplace, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(PLUGINS_ROOT, ".agents", "plugins", "marketplace.json"),
    `${JSON.stringify(codexMarketplace, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(PLUGINS_ROOT, "VERSION"),
    `${version}\n`,
    "utf8",
  );
}

async function writePluginsTopLevelDocs(): Promise<void> {
  for (const name of ["README.md", "README_CN.md"]) {
    const body = await readFile(join(PLUGIN_SOURCE_ROOT, name), "utf8");
    await writeFile(join(PLUGINS_ROOT, name), body, "utf8");
  }

  await copyRuntimeAssets(PLUGINS_ROOT, ["logo.svg"]);

  const gitignorePath = join(PLUGINS_ROOT, ".gitignore");
  if (!(await pathExists(gitignorePath))) {
    await writeFile(
      gitignorePath,
      [
        ".DS_Store",
        "node_modules/",
        ".idea/",
        ".vscode/",
        "",
      ].join("\n"),
      "utf8",
    );
  }
}

async function buildRepoInstall(
  version: string,
  commands: readonly CommandSource[],
): Promise<void> {
  await resetDir(REPO_INSTALL_ROOT);
  await buildClaude(version, join(REPO_INSTALL_ROOT, "claude"));
  await buildCodex(version, commands, join(REPO_INSTALL_ROOT, "codex"));
  await buildCursor(version, commands, join(REPO_INSTALL_ROOT, "cursor"));
  await copyAllCanonicalSkills(REPO_INSTALL_ROOT);
  await Promise.all([
    rm(join(REPO_INSTALL_ROOT, "claude", "CLAUDE.md"), { force: true }),
    rm(join(REPO_INSTALL_ROOT, "codex", "AGENTS.md"), { force: true }),
    rm(join(REPO_INSTALL_ROOT, "cursor", "AGENTS.md"), { force: true }),
  ]);
  for (const name of ["README.md", "README_CN.md"]) {
    await copyFile(join(PLUGIN_SOURCE_ROOT, name), join(REPO_INSTALL_ROOT, name));
  }
  await writeFile(
    join(REPO_INSTALL_ROOT, ".generated"),
    "generated by packages/context-cli/scripts/build-plugin.ts\n",
    "utf8",
  );
  await verifyNoInternalProcedureReferenceLeak(REPO_INSTALL_ROOT, "repo-install");
  await verifyNoClaudePluginRootLeak(REPO_INSTALL_ROOT, "repo-install");
}

async function writeRepositoryMarketplaceManifests(): Promise<void> {
  const claudeMarketplace = {
    name: MARKETPLACE_NAME,
    owner: { name: "c4a" },
    plugins: [{
      name: PLUGIN_NAME,
      source: "./plugins/context/repo-install/claude",
      description: "Start or continue a local knowledge workspace through one graph-routed entry.",
    }],
  };
  const cursorMarketplace = {
    name: MARKETPLACE_NAME,
    owner: { name: "Context4AI", email: "support@context4ai.dev" },
    metadata: { description: "C4A Context plugin marketplace" },
    plugins: [{
      name: PLUGIN_NAME,
      source: "./plugins/context/repo-install/cursor",
      description: "Start or continue a project-local knowledge workspace through one graph-routed entry.",
    }],
  };
  const codexMarketplace = {
    name: MARKETPLACE_NAME,
    interface: { displayName: "C4A Marketplace" },
    plugins: [{
      name: PLUGIN_NAME,
      source: { source: "local", path: "./plugins/context/repo-install/codex" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    }],
  };
  const outputs = [
    [join(repoRoot, ".claude-plugin", "marketplace.json"), claudeMarketplace],
    [join(repoRoot, ".cursor-plugin", "marketplace.json"), cursorMarketplace],
    [join(repoRoot, ".agents", "plugins", "marketplace.json"), codexMarketplace],
  ] as const;
  for (const [path, body] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  }
}

async function main(): Promise<void> {
  const pkgRaw = await readFile(resolve(pkgRoot, "package.json"), "utf-8");
  const pkg = JSON.parse(pkgRaw) as { version?: string };
  const version = pkg.version;
  if (!version) throw new Error("package.json is missing `version`");

  const targetLabel = "dist/plugins";
  await resetDir(PLUGINS_ROOT);

  const commands = await readCommands();
  await buildClaude(version);
  await buildCodex(version, commands);
  await buildCursor(version, commands);
  await buildVercel(commands);
  await writeMarketplaceManifests(version);
  await writePluginsTopLevelDocs();
  await buildRepoInstall(version, commands);
  await writeRepositoryMarketplaceManifests();

  process.stdout.write(`${targetLabel}/claude generated (version=${version})\n`);
  process.stdout.write(`${targetLabel}/codex generated (version=${version}, publicSkills=${commands.length})\n`);
  process.stdout.write(`${targetLabel}/cursor generated (version=${version}, commands=${commands.length})\n`);
  process.stdout.write(`${targetLabel}/skills generated (publicSkills=${commands.length})\n`);
  process.stdout.write(`${targetLabel}/{marketplace.json,README.md,README_CN.md,VERSION} written\n`);
  process.stdout.write(`plugins/context/repo-install generated (version=${version})\n`);
  process.stdout.write(`repository marketplaces generated (host-specific repo-install roots)\n`);
}

main().catch((err) => {
  process.stderr.write(`build-plugin failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
