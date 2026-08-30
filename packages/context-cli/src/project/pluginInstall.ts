import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  claudeSkillsRoot,
  commandAvailable,
  installClaude,
  installCodex,
  installCursor,
  type InstallStep,
  materializeProviderSkills,
  type PluginAgent,
  sharedSkillsRoot,
} from "./pluginInstallTargets.js";

const ANSI_DIM = "\x1b[2m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RESET = "\x1b[0m";

export type { PluginAgent } from "./pluginInstallTargets.js";
export { pruneLegacyCodexConfigContent } from "./pluginInstallTargets.js";
export type PluginAgentOption = PluginAgent | "all";

export interface PluginPathResult {
  pluginsRoot: string;
  candidates: string[];
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

function dim(value: string): string {
  return `${ANSI_DIM}${value}${ANSI_RESET}`;
}

function yellow(value: string): string {
  return `${ANSI_YELLOW}${value}${ANSI_RESET}`;
}

function selectedAgents(agent: PluginAgentOption): PluginAgent[] {
  return agent === "all" ? ["claude", "codex", "cursor"] : [agent];
}

export function pluginAgentOption(value: unknown): PluginAgentOption {
  if (value === undefined || value === "all") return "all";
  if (value === "claude" || value === "codex" || value === "cursor") return value;
  throw new ContextError(ExitCode.UserError, "--agent must be claude, codex, cursor, or all", {
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
    existsSync(join(root, "codex", ".codex-plugin", "plugin.json")) &&
    existsSync(join(root, "cursor", ".cursor-plugin", "plugin.json")) &&
    existsSync(join(root, "skills"));
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

function missingAgentResult(agent: PluginAgent): AgentInstallResult {
  return {
    agent,
    status: "skipped",
    message: `${agent} CLI was not found on PATH`,
    next: agent === "codex"
      ? "Install Codex CLI or rerun for Claude/Cursor."
      : agent === "claude"
      ? "Install Claude CLI or rerun for Codex/Cursor."
      : "Rerun after making the Cursor user plugin directory writable.",
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

export async function runPluginPathCommand(): Promise<PluginPathResult> {
  return resolveBundledPluginsRoot();
}

export async function runPluginStatusCommand(input: { agent: PluginAgentOption }): Promise<PluginStatusResult> {
  const { pluginsRoot } = resolveBundledPluginsRoot();
  const agents = await Promise.all(selectedAgents(input.agent).map(async (agent) => ({
    agent,
    available: agent === "cursor" || await commandAvailable(agent),
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
  let sharedProviderSkillsReady = false;
  for (const agent of agents) {
    if (agent !== "cursor" && !dryRun && !await commandAvailable(agent)) {
      results.push(missingAgentResult(agent));
      steps.push({
        agent,
        command: `${agent} CLI not found on PATH`,
        status: "skipped",
      });
      continue;
    }
    try {
      if (agent === "claude") {
        await installClaude(pluginsRoot, dryRun, steps);
        await materializeProviderSkills(pluginsRoot, claudeSkillsRoot(), agent, dryRun, steps);
      } else if (agent === "codex") {
        await installCodex(pluginsRoot, dryRun, steps);
        if (!sharedProviderSkillsReady) {
          await materializeProviderSkills(pluginsRoot, sharedSkillsRoot(), agent, dryRun, steps);
          sharedProviderSkillsReady = true;
        }
      } else {
        await installCursor(pluginsRoot, dryRun, steps);
        if (!sharedProviderSkillsReady) {
          await materializeProviderSkills(pluginsRoot, sharedSkillsRoot(), agent, dryRun, steps);
          sharedProviderSkillsReady = true;
        }
      }
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
      next: "Install at least one supported agent CLI or rerun for the filesystem-backed Cursor target.",
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
    "manual install: use the marketplace path above as the plugin marketplace root.",
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
