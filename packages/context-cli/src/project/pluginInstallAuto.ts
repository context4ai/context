import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { installLocalSkills } from "./pluginInstallLocal.js";
import type { PluginAgent } from "./pluginInstallTargets.js";

const HOST_DIRS = { claude: ".claude", cursor: ".cursor", codex: ".agents" } as const;

export async function detectLocalAgent(agent: PluginAgent): Promise<boolean> {
  const commands = agent === "cursor" ? ["cursor", "cursor-agent"] : [agent];
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const command of commands) {
      for (const suffix of process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]) {
        const file = join(directory, command + suffix);
        try {
          if (!(await stat(file)).isFile()) continue;
          await access(file, constants.X_OK);
          return true;
        } catch { /* Missing or inaccessible executable is not an installed target. */ }
      }
    }
  }
  // Desktop installs may not have a launcher on PATH. Do not infer installation
  // from stale user configuration directories.
  if (process.platform === "darwin") {
    const app = { claude: "Claude.app", cursor: "Cursor.app", codex: "Codex.app" }[agent];
    // Claude Desktop is not evidence of Claude Code support.
    if (agent !== "claude") {
      for (const directory of ["/Applications", join(homedir(), "Applications")]) {
        try { if ((await stat(join(directory, app))).isDirectory()) return true; } catch { /* Not installed. */ }
      }
    }
  }
  return false;
}

export async function installAutoLocalSkills(
  root: string, path: string, dryRun: boolean,
  detect: (agent: PluginAgent) => Promise<boolean> = detectLocalAgent,
): Promise<string> {
  if (!path.trim()) throw new ContextError(ExitCode.UserError, "--local requires a non-empty repository path", {
    category: ErrorCategory.UserInputInvalid,
    next: "Run context plugin install --local /path/to/repository.",
  });
  const requested = resolve(path);
  const repo = Object.values(HOST_DIRS).some(name => name === basename(requested)) ? dirname(requested) : requested;
  const agents: PluginAgent[] = [];
  for (const agent of ["claude", "cursor", "codex"] as const) {
    if (await detect(agent)) agents.push(agent);
  }
  const targets: Array<{ agent?: PluginAgent; path: string }> = agents.length
    ? agents.map(agent => ({ agent, path: join(repo, HOST_DIRS[agent]) }))
    : [{ path: join(repo, ".agents") }];
  // Validate all detected destinations before the first write.
  const previews: string[] = [];
  for (const target of targets) previews.push(await installLocalSkills(root, target.path, true, target.agent));
  const header = formatFeedback({
    symbol: agents.length ? "✓" : "⚠", action: "detected", subject: "local agent targets",
    headline: agents.length ? agents.join(", ") : "No supported agent detected",
    body: [
      `repository: ${repo}`,
      ...targets.map(target => `${target.agent ?? "standalone"}: ${target.path}`),
      ...(!agents.length ? ["Installing only .agents/skills. Configure a supported host to read this directory, or rerun with an explicit --agent and its target path."] : []),
      "Host discovery does not verify runtime skill loading; refresh the host after installation.",
    ],
  });
  if (dryRun) return header + previews.join("");
  const results: string[] = [];
  for (const target of targets) results.push(await installLocalSkills(root, target.path, false, target.agent));
  return header + results.join("");
}
