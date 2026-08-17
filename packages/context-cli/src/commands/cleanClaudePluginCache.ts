import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatFeedback } from "../lib/cliFeedback.js";

const ORPHAN_MARKER = ".orphaned_at";
const CLAUDE_PLUGIN_CACHE_ROOT_ENV = "C4A_CLAUDE_PLUGIN_CACHE_ROOT";
const CLAUDE_PLUGIN_CACHE_HOME_ENV = "C4A_CLAUDE_PLUGIN_CACHE_HOME";

export interface DoctorOptions {
  home?: string;
  cacheRoot?: string;
  silent?: boolean;
  dryRun?: boolean;
}

interface CleanResult {
  lines: string[];
  removed: number;
  scanned: number;
}

export async function cleanClaudePluginCache(opts: DoctorOptions = {}): Promise<CleanResult> {
  const cacheRoot = resolveClaudePluginCacheRoot(opts);
  const lines: string[] = [];
  let removed = 0;
  let scanned = 0;

  if (!existsSync(cacheRoot)) {
    lines.push("· claude plugin cache: missing — nothing to clean");
    return { lines, removed, scanned };
  }

  const marketplaces = await readdir(cacheRoot, { withFileTypes: true });
  for (const mp of marketplaces) {
    if (!mp.isDirectory()) continue;
    const mpDir = join(cacheRoot, mp.name);
    const plugins = await readdir(mpDir, { withFileTypes: true });
    for (const pl of plugins) {
      if (!pl.isDirectory()) continue;
      const plDir = join(mpDir, pl.name);
      const versions = await readdir(plDir, { withFileTypes: true });
      for (const ver of versions) {
        if (!ver.isDirectory()) continue;
        scanned += 1;
        const verDir = join(plDir, ver.name);
        const markerPath = join(verDir, ORPHAN_MARKER);
        if (!existsSync(markerPath)) continue;
        const label = `${mp.name}/${pl.name}/${ver.name}`;
        if (opts.dryRun) {
          lines.push(`  - would remove: ${label}`);
        } else {
          await rm(verDir, { recursive: true, force: true });
          removed += 1;
          lines.push(`  ✓ removed: ${label}`);
        }
      }
      if (!opts.dryRun && (await isEmptyDir(plDir))) {
        await rm(plDir, { recursive: true, force: true });
      }
    }
    if (!opts.dryRun && (await isEmptyDir(mpDir))) {
      await rm(mpDir, { recursive: true, force: true });
    }
  }

  if (scanned === 0) {
    lines.push("· claude plugin cache: empty — no plugin versions found");
  } else if (removed === 0 && !opts.dryRun) {
    lines.push(`· scanned ${scanned} version(s), nothing to clean (no .orphaned_at markers)`);
  }

  return { lines, removed, scanned };
}

function resolveClaudePluginCacheRoot(opts: DoctorOptions): string {
  const explicitRoot = opts.cacheRoot ?? process.env[CLAUDE_PLUGIN_CACHE_ROOT_ENV];
  if (explicitRoot) return explicitRoot;
  const home = opts.home ?? process.env[CLAUDE_PLUGIN_CACHE_HOME_ENV] ?? homedir();
  return join(home, ".claude", "plugins", "cache");
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length === 0;
  } catch {
    return false;
  }
}

export async function runDoctorCleanClaudePluginCache(opts: DoctorOptions = {}): Promise<void> {
  const result = await cleanClaudePluginCache(opts);
  if (opts.silent) return;
  const wouldRemove = result.lines.filter((line) => line.includes("would remove")).length;
  const headline = opts.dryRun
    ? `dry-run: would remove ${wouldRemove} of ${result.scanned} version(s)`
    : `removed ${result.removed} of ${result.scanned} version(s)`;
  process.stdout.write(formatFeedback({
    symbol: opts.dryRun ? "·" : result.removed === 0 ? "·" : "✓",
    action: opts.dryRun ? "scanned" : "cleaned",
    subject: "Claude plugin cache",
    headline,
    body: result.lines.map((line) => line.replace(/^\s+/, "")),
  }));
}
