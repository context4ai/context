import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

const execFileAsync = promisify(execFile);
const MARKETPLACE_NAME = "c4a";
const PLUGIN_ID = "context@c4a";
const PLUGIN_NAME = "context";
const LEGACY_PLUGIN_NAMES: readonly string[] = [];
const ORPHAN_MARKER = ".orphaned_at";
const CLAUDE_PLUGIN_CACHE_ROOT_ENV = "C4A_CLAUDE_PLUGIN_CACHE_ROOT";
const CLAUDE_PLUGIN_CACHE_HOME_ENV = "C4A_CLAUDE_PLUGIN_CACHE_HOME";
const ANSI_DIM = "\x1b[2m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RESET = "\x1b[0m";

export type PluginAgent = "claude" | "codex";
export type PluginAgentOption = PluginAgent | "all";

export interface PluginPathResult {
  pluginsRoot: string;
  candidates: string[];
}

interface InstallStep {
  agent: PluginAgent;
  command: string;
  status: "planned" | "ran" | "skipped";
}

interface AgentInstallResult {
  agent: PluginAgent;
  status: "planned" | "installed" | "skipped" | "failed";
  message?: string;
  next?: string;
}

export interface PluginInstallResult {
  pluginsRoot: string;
  dryRun: boolean;
  steps: InstallStep[];
  agents: PluginAgent[];
  results: AgentInstallResult[];
}

export interface PluginStatusResult {
  pluginsRoot: string;
  agents: Array<{
    agent: PluginAgent;
    available: boolean;
  }>;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandLine(command: string, args: readonly string[]): string {
  return [command, ...args.map((arg) => shellQuote(arg))].join(" ");
}

function dim(value: string): string {
  return `${ANSI_DIM}${value}${ANSI_RESET}`;
}

function yellow(value: string): string {
  return `${ANSI_YELLOW}${value}${ANSI_RESET}`;
}

function selectedAgents(agent: PluginAgentOption): PluginAgent[] {
  return agent === "all" ? ["claude", "codex"] : [agent];
}

export function pluginAgentOption(value: unknown): PluginAgentOption {
  if (value === undefined || value === "all") return "all";
  if (value === "claude" || value === "codex") return value;
  throw new ContextError(ExitCode.UserError, "--agent must be claude, codex, or all", {
    category: ErrorCategory.UserInputInvalid,
  });
}

function packageCandidateDirs(): string[] {
  const dirs: string[] = [];
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index++) {
    dirs.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [...new Set(dirs)];
}

function pluginRootCandidates(): string[] {
  const envRoot = process.env.C4A_CONTEXT_PLUGIN_ROOT?.trim();
  if (envRoot) return [resolve(envRoot)];

  const candidates: string[] = [];
  for (const dir of packageCandidateDirs()) {
    candidates.push(join(dir, "plugins"));
    candidates.push(join(dir, "dist", "plugins"));
  }
  return [...new Set(candidates)];
}

function isInstallablePluginRoot(root: string): boolean {
  return existsSync(join(root, ".claude-plugin", "marketplace.json")) &&
    existsSync(join(root, ".agents", "plugins", "marketplace.json")) &&
    existsSync(join(root, "claude", ".claude-plugin", "plugin.json")) &&
    existsSync(join(root, "codex", ".codex-plugin", "plugin.json"));
}

export function resolveBundledPluginsRoot(): PluginPathResult {
  const candidates = pluginRootCandidates();
  const pluginsRoot = candidates.find(isInstallablePluginRoot);
  if (!pluginsRoot) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "bundled Context plugin marketplace was not found",
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        tried: candidates,
        next: "run `bun run --filter @c4a/context-cli build` before installing the plugin from a checkout",
      },
    );
  }
  return { pluginsRoot, candidates };
}

async function runExternal(command: string, args: readonly string[]): Promise<void> {
  try {
    await execFileAsync(command, args, {
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContextError(ExitCode.ExternalToolError, `${commandLine(command, args)} failed: ${message}`, {
      category: ErrorCategory.ExternalToolFailed,
    });
  }
}

async function runExternalOptional(command: string, args: readonly string[]): Promise<boolean> {
  try {
    await runExternal(command, args);
    return true;
  } catch {
    return false;
  }
}

async function commandAvailable(command: string): Promise<boolean> {
  return runExternalOptional("sh", ["-lc", `command -v ${command} >/dev/null 2>&1`]);
}

async function claudePluginInstalled(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("claude", ["plugin", "list", "--json"], {
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as unknown;
    return Array.isArray(parsed) && parsed.some((item) => (
      item !== null && typeof item === "object" && "id" in item && item.id === PLUGIN_ID
    ));
  } catch {
    return false;
  }
}

function missingAgentResult(agent: PluginAgent): AgentInstallResult {
  return {
    agent,
    status: "skipped",
    message: `${agent} CLI was not found on PATH`,
    next: agent === "codex"
      ? "Install Codex CLI or rerun `context plugin install --agent claude` to install only Claude."
      : "Install Claude CLI or rerun `context plugin install --agent codex` to install only Codex.",
  };
}

function failedAgentResult(agent: PluginAgent, error: unknown): AgentInstallResult {
  return {
    agent,
    status: "failed",
    message: error instanceof Error ? error.message : String(error),
    next: `Fix the ${agent} plugin command failure, then rerun \`context plugin install --agent ${agent}\`.`,
  };
}

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

function claudePluginCacheRoot(): string {
  const explicitRoot = process.env[CLAUDE_PLUGIN_CACHE_ROOT_ENV]?.trim();
  if (explicitRoot) return explicitRoot;
  const home = process.env[CLAUDE_PLUGIN_CACHE_HOME_ENV]?.trim() || homedir();
  return join(home, ".claude", "plugins", "cache");
}

function blockHeader(line: string): string | null {
  const match = line.match(/^\s*\[([^\]]+)\]\s*$/u);
  return match?.[1] ?? null;
}

function isStaleMarketplaceBlock(header: string, block: readonly string[]): boolean {
  if (header === "marketplaces.context") return true;
  if (header !== `marketplaces.${MARKETPLACE_NAME}`) return false;
  const text = block.join("\n");
  return text.includes('source_type = "local"') || text.includes("/c4a-plugins") || text.includes("context4ai/context");
}

function isStalePluginBlock(header: string): boolean {
  return header === `plugins."context@context"` || header === "plugins.context";
}

export function pruneLegacyCodexConfigContent(content: string): { content: string; removed: string[] } {
  const lines = content.split("\n");
  const kept: string[] = [];
  const removed: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const header = blockHeader(line);
    if (!header) {
      kept.push(line);
      index += 1;
      continue;
    }

    const start = index;
    index += 1;
    while (index < lines.length && blockHeader(lines[index] ?? "") === null) {
      index += 1;
    }
    const block = lines.slice(start, index);
    if (isStaleMarketplaceBlock(header, block) || isStalePluginBlock(header)) {
      removed.push(header);
      while (kept.length > 0 && (kept[kept.length - 1] ?? "").trim() === "") {
        kept.pop();
      }
      continue;
    }
    kept.push(...block);
  }

  return { content: kept.join("\n"), removed };
}

async function pruneLegacyCodexConfig(dryRun: boolean, steps: InstallStep[]): Promise<void> {
  const configPath = join(codexHome(), "config.toml");
  const current = await readFile(configPath, "utf8").catch(() => "");
  if (!current) return;
  const next = pruneLegacyCodexConfigContent(current);
  if (next.removed.length === 0) return;

  steps.push({
    agent: "codex",
    command: `prune stale Codex config blocks: ${next.removed.join(", ")}`,
    status: dryRun ? "planned" : "ran",
  });
  if (!dryRun) {
    await writeFile(configPath, next.content, "utf8");
  }
}

async function pruneCodexPluginCacheForName(
  pluginName: string,
  keepVersion: string | undefined,
  dryRun: boolean,
  steps: InstallStep[],
): Promise<void> {
  const cacheRoot = join(codexHome(), "plugins", "cache", MARKETPLACE_NAME, pluginName);
  if (!existsSync(cacheRoot)) return;
  const versions = (await readdir(cacheRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && entry.name !== keepVersion)
    .map((entry) => entry.name)
    .sort();
  if (versions.length === 0) return;

  steps.push({
    agent: "codex",
    command: `prune cached Codex ${MARKETPLACE_NAME}/${pluginName} version(s): ${versions.join(", ")}`,
    status: dryRun ? "planned" : "ran",
  });
  if (!dryRun) await Promise.all(versions.map((version) => rm(join(cacheRoot, version), { recursive: true, force: true })));
}

async function pruneCodexPluginCache(currentVersion: string, dryRun: boolean, steps: InstallStep[]): Promise<void> {
  await pruneCodexPluginCacheForName(PLUGIN_NAME, currentVersion, dryRun, steps);
  for (const pluginName of LEGACY_PLUGIN_NAMES) {
    await pruneCodexPluginCacheForName(pluginName, undefined, dryRun, steps);
  }
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch {
    return false;
  }
}

async function pruneClaudeOrphanContextCache(dryRun: boolean, steps: InstallStep[]): Promise<void> {
  const cacheRoot = claudePluginCacheRoot();
  if (!existsSync(cacheRoot)) return;

  const removed: string[] = [];
  const marketplaces = await readdir(cacheRoot, { withFileTypes: true }).catch(() => []);
  for (const marketplace of marketplaces) {
    if (!marketplace.isDirectory()) continue;
    const pluginDir = join(cacheRoot, marketplace.name, PLUGIN_NAME);
    if (!existsSync(pluginDir)) continue;
    const versions = await readdir(pluginDir, { withFileTypes: true }).catch(() => []);
    for (const version of versions) {
      if (!version.isDirectory()) continue;
      const versionDir = join(pluginDir, version.name);
      if (!existsSync(join(versionDir, ORPHAN_MARKER))) continue;
      removed.push(`${marketplace.name}/${PLUGIN_NAME}/${version.name}`);
      if (!dryRun) {
        await rm(versionDir, { recursive: true, force: true });
      }
    }
    if (!dryRun && await isEmptyDir(pluginDir)) {
      await rm(pluginDir, { recursive: true, force: true });
    }
    const marketplaceDir = join(cacheRoot, marketplace.name);
    if (!dryRun && await isEmptyDir(marketplaceDir)) {
      await rm(marketplaceDir, { recursive: true, force: true });
    }
  }

  if (removed.length > 0) {
    steps.push({
      agent: "claude",
      command: `prune orphaned Claude context cache version(s): ${removed.join(", ")}`,
      status: dryRun ? "planned" : "ran",
    });
  }
}

async function pruneClaudeLegacyPluginCache(dryRun: boolean, steps: InstallStep[]): Promise<void> {
  if (LEGACY_PLUGIN_NAMES.length === 0) return;
  const cacheRoot = claudePluginCacheRoot();
  if (!existsSync(cacheRoot)) return;

  const removed: string[] = [];
  for (const pluginName of LEGACY_PLUGIN_NAMES) {
    const pluginDir = join(cacheRoot, MARKETPLACE_NAME, pluginName);
    if (!existsSync(pluginDir)) continue;
    removed.push(`${MARKETPLACE_NAME}/${pluginName}`);
    if (!dryRun) {
      await rm(pluginDir, { recursive: true, force: true });
    }
  }

  if (removed.length > 0) {
    steps.push({
      agent: "claude",
      command: `prune legacy Claude plugin cache(s): ${removed.join(", ")}`,
      status: dryRun ? "planned" : "ran",
    });
  }
}

async function pruneClaudeSupersededContextCache(
  root: string,
  dryRun: boolean,
  steps: InstallStep[],
): Promise<void> {
  const manifest = await readFile(join(root, "claude", ".claude-plugin", "plugin.json"), "utf8")
    .then((content) => JSON.parse(content) as { version?: unknown })
    .catch(() => null);
  const currentVersion = typeof manifest?.version === "string" ? manifest.version : null;
  if (!currentVersion) return;

  const pluginDir = join(claudePluginCacheRoot(), MARKETPLACE_NAME, PLUGIN_NAME);
  const staleVersions = (await readdir(pluginDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && entry.name !== currentVersion)
    .map((entry) => entry.name);
  if (staleVersions.length === 0) return;

  steps.push({
    agent: "claude",
    command: `prune superseded Claude ${MARKETPLACE_NAME}/${PLUGIN_NAME} version(s): ${staleVersions.join(", ")}`,
    status: dryRun ? "planned" : "ran",
  });
  if (!dryRun) {
    await Promise.all(staleVersions.map((version) => (
      rm(join(pluginDir, version), { recursive: true, force: true })
    )));
  }
}

function enableCodexPluginConfig(content: string): string {
  const header = `[plugins."${PLUGIN_ID}"]`;
  const blockStart = content.indexOf(header);
  if (blockStart === -1) {
    const prefix = content.endsWith("\n") || content.length === 0 ? content : `${content}\n`;
    return `${prefix}\n${header}\nenabled = true\n`;
  }

  const nextBlockMatch = content.slice(blockStart + header.length).match(/\n\[/u);
  const blockEnd = nextBlockMatch?.index === undefined
    ? content.length
    : blockStart + header.length + nextBlockMatch.index + 1;
  const before = content.slice(0, blockStart);
  const block = content.slice(blockStart, blockEnd);
  const after = content.slice(blockEnd);
  const lines = block.split("\n").filter((line) => !/^\s*enabled\s*=/u.test(line));
  if (lines[lines.length - 1] !== "") lines.push("");
  lines.splice(1, 0, "enabled = true");
  return `${before}${lines.join("\n")}${after}`;
}

function removeTomlBlock(content: string, headerName: string): string {
  const lines = content.split("\n");
  const kept: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const header = blockHeader(line);
    if (header !== headerName) {
      kept.push(line);
      index += 1;
      continue;
    }

    index += 1;
    while (index < lines.length && blockHeader(lines[index] ?? "") === null) {
      index += 1;
    }
    while (kept.length > 0 && (kept[kept.length - 1] ?? "").trim() === "") {
      kept.pop();
    }
  }

  return kept.join("\n");
}

function upsertCodexLocalMarketplaceConfig(content: string, root: string): string {
  const withoutExisting = removeTomlBlock(content, `marketplaces.${MARKETPLACE_NAME}`);
  const prefix = withoutExisting.endsWith("\n") || withoutExisting.length === 0
    ? withoutExisting
    : `${withoutExisting}\n`;
  return `${prefix}\n[marketplaces.${MARKETPLACE_NAME}]\nsource_type = "local"\nsource = ${JSON.stringify(root)}\n`;
}

async function ensureCodexPluginEnabled(): Promise<void> {
  const configPath = join(codexHome(), "config.toml");
  await mkdir(dirname(configPath), { recursive: true });
  const current = await readFile(configPath, "utf8").catch(() => "");
  const next = enableCodexPluginConfig(current);
  if (next !== current) {
    await writeFile(configPath, next, "utf8");
  }
}

async function ensureCodexLocalMarketplace(root: string): Promise<void> {
  const configPath = join(codexHome(), "config.toml");
  await mkdir(dirname(configPath), { recursive: true });
  const current = await readFile(configPath, "utf8").catch(() => "");
  const next = upsertCodexLocalMarketplaceConfig(current, root);
  if (next !== current) {
    await writeFile(configPath, next, "utf8");
  }
}

async function codexPluginVersion(root: string): Promise<string> {
  const manifestPath = join(root, "codex", ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(manifest.version)) {
    throw new Error(`Codex plugin manifest has an invalid version: ${manifestPath}`);
  }
  return manifest.version;
}

function codexPluginCacheDir(version: string): string {
  return join(codexHome(), "plugins", "cache", MARKETPLACE_NAME, PLUGIN_NAME, version);
}

async function materializeCodexPluginCache(
  root: string,
  version: string,
  dryRun: boolean,
  steps: InstallStep[],
): Promise<void> {
  const source = join(root, "codex");
  const target = codexPluginCacheDir(version);
  steps.push({
    agent: "codex",
    command: `materialize Codex plugin cache: ${shellQuote(source)} -> ${shellQuote(target)}`,
    status: dryRun ? "planned" : "ran",
  });
  if (dryRun) return;

  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  const previous = `${target}.previous-${process.pid}-${Date.now()}`;
  await rm(temporary, { recursive: true, force: true });
  await cp(source, temporary, { recursive: true, force: true });
  const hadPrevious = existsSync(target);
  try {
    if (hadPrevious) await rename(target, previous);
    await rename(temporary, target);
    if (hadPrevious) await rm(previous, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (hadPrevious && !existsSync(target) && existsSync(previous)) await rename(previous, target);
    throw error;
  }
}

async function installClaude(root: string, dryRun: boolean, steps: InstallStep[]): Promise<void> {
  await pruneClaudeOrphanContextCache(dryRun, steps);
  await pruneClaudeLegacyPluginCache(dryRun, steps);
  const addArgs = ["plugin", "marketplace", "add", root];
  const installArgs = ["plugin", "install", PLUGIN_ID, "--scope", "user"];
  steps.push({ agent: "claude", command: commandLine("claude", addArgs), status: dryRun ? "planned" : "ran" });
  if (dryRun) {
    steps.push({ agent: "claude", command: commandLine("claude", installArgs), status: "planned" });
    return;
  }

  const added = await runExternalOptional("claude", addArgs);
  if (!added) {
    await runExternal("claude", ["plugin", "marketplace", "update", MARKETPLACE_NAME]);
  }
  if (await claudePluginInstalled()) {
    const uninstallArgs = ["plugin", "uninstall", PLUGIN_ID, "--scope", "user"];
    steps.push({ agent: "claude", command: commandLine("claude", uninstallArgs), status: "ran" });
    await runExternal("claude", uninstallArgs);
  }
  steps.push({ agent: "claude", command: commandLine("claude", installArgs), status: "ran" });
  await runExternal("claude", installArgs);
  await pruneClaudeSupersededContextCache(root, dryRun, steps);
}

async function installCodex(root: string, dryRun: boolean, steps: InstallStep[]): Promise<void> {
  const currentVersion = await codexPluginVersion(root);
  await pruneLegacyCodexConfig(dryRun, steps);
  const addArgs = ["plugin", "marketplace", "add", root];
  steps.push({ agent: "codex", command: commandLine("codex", addArgs), status: dryRun ? "planned" : "ran" });
  steps.push({
    agent: "codex",
    command: `ensure ${shellQuote(join(codexHome(), "config.toml"))} registers local marketplace ${shellQuote(MARKETPLACE_NAME)}`,
    status: dryRun ? "planned" : "ran",
  });
  steps.push({
    agent: "codex",
    command: `ensure ${shellQuote(join(codexHome(), "config.toml"))} enables ${shellQuote(PLUGIN_ID)}`,
    status: dryRun ? "planned" : "ran",
  });
  if (dryRun) {
    await materializeCodexPluginCache(root, currentVersion, dryRun, steps);
    await pruneCodexPluginCache(currentVersion, dryRun, steps);
    return;
  }

  await runExternalOptional("codex", addArgs);
  await ensureCodexLocalMarketplace(root);
  await ensureCodexPluginEnabled();
  await materializeCodexPluginCache(root, currentVersion, dryRun, steps);
  await pruneCodexPluginCache(currentVersion, dryRun, steps);
}

export async function runPluginPathCommand(): Promise<PluginPathResult> {
  return resolveBundledPluginsRoot();
}

export async function runPluginStatusCommand(input: { agent: PluginAgentOption }): Promise<PluginStatusResult> {
  const { pluginsRoot } = resolveBundledPluginsRoot();
  const agents = await Promise.all(selectedAgents(input.agent).map(async (agent) => ({
    agent,
    available: await commandAvailable(agent),
  })));
  return { pluginsRoot, agents };
}

export async function runPluginInstallCommand(input: {
  agent: PluginAgentOption;
  dryRun?: boolean;
}): Promise<PluginInstallResult> {
  const { pluginsRoot } = resolveBundledPluginsRoot();
  const dryRun = input.dryRun === true;
  const steps: InstallStep[] = [];
  const agents = selectedAgents(input.agent);
  const results: AgentInstallResult[] = [];
  for (const agent of agents) {
    if (!dryRun && !await commandAvailable(agent)) {
      results.push(missingAgentResult(agent));
      steps.push({
        agent,
        command: `${agent} CLI not found on PATH`,
        status: "skipped",
      });
      continue;
    }
    try {
      if (agent === "claude") await installClaude(pluginsRoot, dryRun, steps);
      else await installCodex(pluginsRoot, dryRun, steps);
      results.push({ agent, status: dryRun ? "planned" : "installed" });
    } catch (error) {
      results.push(failedAgentResult(agent, error));
    }
  }

  const readyCount = results.filter((result) => result.status === "installed" || result.status === "planned").length;
  if (readyCount === 0 && !dryRun) {
    throw new ContextError(ExitCode.ExternalToolError, "no requested agent plugin target could be installed", {
      category: ErrorCategory.ExternalToolFailed,
      agents: results,
      next: "Install at least one supported agent CLI or rerun with a specific available target, for example `context plugin install --agent claude`.",
    });
  }

  return { pluginsRoot, dryRun, steps, agents, results };
}

export function formatPluginPathResult(result: PluginPathResult): string {
  return formatFeedback({
    symbol: "✓",
    action: "resolved",
    subject: "context plugin",
    headline: result.pluginsRoot,
    body: [`candidates checked: ${result.candidates.length}`],
  });
}

export function formatPluginStatusResult(result: PluginStatusResult): string {
  return formatFeedback({
    symbol: "✓",
    action: "inspected",
    subject: "context plugin",
    headline: result.pluginsRoot,
    body: result.agents.map((agent) => `${agent.agent}: ${agent.available ? "available" : "not found on PATH"}`),
  });
}

export function formatPluginInstallResult(result: PluginInstallResult): string {
  const degraded = result.results.some((item) => item.status === "skipped" || item.status === "failed");
  const ready = result.results
    .filter((item) => item.status === "installed" || item.status === "planned")
    .map((item) => item.agent);
  const body: Array<string | undefined> = [
    `marketplace: ${dim(result.pluginsRoot)}`,
    `manual install: use the marketplace path above as the plugin marketplace root.`,
  ];
  for (const item of result.results) {
    if (item.status === "installed" || item.status === "planned") {
      body.push(`✅ ${item.agent}: ${item.status}`);
      continue;
    }
    const icon = item.status === "failed" ? "✗" : "⚠";
    const detail = item.message ? ` — ${item.message}` : "";
    body.push(yellow(`${icon} ${item.agent}: ${item.status}${detail}`));
    if (item.next) body.push(yellow(`  next: ${item.next}`));
  }
  const detailSteps = result.steps.map((step) => `  ${step.agent}: ${step.status} ${step.command}`);
  if (detailSteps.length > 0) {
    body.push("details:");
    body.push(...detailSteps.map(dim));
  }
  return formatFeedback({
    symbol: result.dryRun ? "·" : degraded ? "⚠" : "✓",
    action: result.dryRun ? "planned" : "installed",
    subject: "context plugin",
    headline: `${ready.length}/${result.agents.length} target(s) ready`,
    body,
  });
}
