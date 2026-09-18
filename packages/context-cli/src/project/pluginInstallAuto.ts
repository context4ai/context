import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { installLocalSkills } from "./pluginInstallLocal.js";
import type { PluginAgent } from "./pluginInstallTargets.js";

const HOST_DIRS = { claude: ".claude", cursor: ".cursor", codex: ".agents" } as const;

export async function detectLocalAgent(agent: PluginAgent, repo: string): Promise<boolean> {
  const path = join(repo, HOST_DIRS[agent]);
  try {
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new ContextError(ExitCode.UserError, `Local host directory is not a regular directory: ${path}`);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function installAutoLocalSkills(
  root: string, path: string, dryRun: boolean,
  detect: (agent: PluginAgent, repo: string) => Promise<boolean> = detectLocalAgent,
  selectedAgent?: PluginAgent | "all",
): Promise<string> {
  if (!path.trim()) throw new ContextError(ExitCode.UserError, "--local requires a non-empty repository path", {
    category: ErrorCategory.UserInputInvalid,
    next: "Run context plugin install --local /path/to/repository --agent auto-detect.",
  });
  const repo = resolve(path);
  const agents: PluginAgent[] = [];
  for (const agent of ["claude", "cursor", "codex"] as const) {
    if (selectedAgent ? selectedAgent === "all" || agent === selectedAgent : await detect(agent, repo)) agents.push(agent);
  }
  const targets: Array<{ agent?: PluginAgent; path: string }> = agents.length
    ? agents.map(agent => ({ agent, path: join(repo, HOST_DIRS[agent]) }))
    : [{ path: join(repo, ".agents") }];
  // Validate all detected destinations before the first write.
  const previews: string[] = [];
  for (const target of targets) previews.push(await installLocalSkills(root, target.path, true, target.agent));
  const header = formatFeedback({
    symbol: agents.length ? "✓" : "⚠", action: selectedAgent ? "selected" : "detected", subject: "local agent targets",
    headline: agents.length ? agents.join(", ") : "No supported host directory found",
    body: [
      `repository: ${repo}`,
      ...targets.map(target => `${target.agent ?? "standalone"}: ${target.path}`),
      ...(!agents.length ? ["Installing only .agents/skills. Configure a supported host to read this directory, or select an explicit --agent with the same repository root."] : []),
      "Repository directory discovery does not verify runtime skill loading; refresh the host after installation.",
    ],
  });
  if (dryRun) return header + previews.join("");
  const results: string[] = [];
  for (const target of targets) results.push(await installLocalSkills(root, target.path, false, target.agent));
  return header + results.join("");
}
