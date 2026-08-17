#!/usr/bin/env node
/**
 * Best-effort global agent plugin refresh after a global context-cli install.
 * Local project dependencies and CI installs must not mutate user-level agent
 * configuration. Link development performs the same refresh in cliLink.ts.
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import process from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RE_ENTRY_ENV = "CONTEXT_CLI_POSTINSTALL";
export const SKIP_PLUGIN_INSTALL_ENV = "CONTEXT_CLI_SKIP_PLUGIN_INSTALL";
export const FORCE_PLUGIN_INSTALL_ENV = "CONTEXT_CLI_AUTO_PLUGIN_INSTALL";

export function looksLikeClaudePluginInstall(env) {
  const hints = ["CLAUDE_PLUGIN_INSTALL", "CLAUDE_CODE_PLUGIN", "npm_config_user_agent"];
  return hints.some((key) => env[key]?.toLowerCase().includes("claude") === true);
}

export function isGlobalPackageInstall(env) {
  return env.npm_config_global === "true" ||
    env.npm_config_global === "1" ||
    env.npm_config_location === "global";
}

export function decide(env, hasContextBin) {
  if (env[RE_ENTRY_ENV] === "1") return { action: "skip", reason: "re-entry guard" };
  if (env.CI === "true" || env.CI === "1") return { action: "skip", reason: "CI" };
  if (env[SKIP_PLUGIN_INSTALL_ENV] === "1") return { action: "skip", reason: "explicit opt-out" };
  if (env[FORCE_PLUGIN_INSTALL_ENV] === "1" || isGlobalPackageInstall(env)) {
    return { action: "install" };
  }
  if (!looksLikeClaudePluginInstall(env)) return { action: "skip", reason: "local dependency install" };
  if (hasContextBin) return { action: "skip", reason: "context already on PATH" };
  const version = env.npm_package_version ?? "latest";
  return {
    action: "hint",
    lines: [
      "Claude plugin installed without a global context CLI. Install it with:",
      `  npm install -g @c4a/context-cli@${version}`,
    ],
  };
}

export function probeContextBin() {
  const lookup = process.platform === "win32"
    ? spawnSync("where", ["context"], { stdio: "ignore" })
    : spawnSync("sh", ["-c", "command -v context"], { stdio: "ignore" });
  return lookup.status === 0;
}

export function resolveBundledCliEntry(metaUrl) {
  const scriptDir = dirname(fileURLToPath(metaUrl));
  const candidates = [
    join(scriptDir, "..", "cli.js"),
    join(scriptDir, "..", "dist", "cli.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function log(message) {
  process.stderr.write(`[context-cli postinstall] ${message}\n`);
}

function installPlugin(env) {
  const cliEntry = resolveBundledCliEntry(import.meta.url);
  if (cliEntry === null) {
    log("plugin refresh skipped: bundled cli.js was not found; run `context plugin install` later.");
    return;
  }
  log("refreshing global Context agent plugins...");
  const result = spawnSync(process.execPath, [cliEntry, "plugin", "install"], {
    env: { ...env, [RE_ENTRY_ENV]: "1" },
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    log(`plugin refresh failed: ${result.error.message}; run \`context plugin install\` later.`);
  } else if (result.status !== 0) {
    log(`plugin refresh exited with code ${result.status ?? "unknown"}; run \`context plugin install\` later.`);
  } else {
    log("global Context agent plugins refreshed.");
  }
}

function main() {
  const provisional = decide(process.env, false);
  if (provisional.action === "install") {
    installPlugin(process.env);
    return;
  }
  if (provisional.action === "skip") return;
  const final = decide(process.env, probeContextBin());
  if (final.action === "hint") {
    for (const line of final.lines) log(line);
  }
}

export function isDirectRun(metaUrl, argv1) {
  if (!argv1) return false;
  try {
    let resolved = argv1;
    try {
      resolved = realpathSync(argv1);
    } catch {
      // Keep the raw path when lifecycle timing makes argv[1] unavailable.
    }
    return metaUrl === pathToFileURL(resolved).href;
  } catch {
    return false;
  }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  try {
    main();
  } catch (error) {
    log(`postinstall error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
