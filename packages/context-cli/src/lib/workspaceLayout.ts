import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import YAML from "yaml";

export type WorkspaceLayout = "embedded" | "root";

export interface WorkspaceLocation {
  ctxDir: string;
  workspaceRoot: string;
  layout: WorkspaceLayout;
}

function isDirectorySafe(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function normalizeWorkspaceLayout(value: unknown, fallback: WorkspaceLayout = "embedded"): WorkspaceLayout {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === "embedded" || value === "root") return value;
  throw new Error(`workspace layout must be one of embedded/root, got "${String(value)}"`);
}

export function contextDirForLayout(cwd: string, layout: WorkspaceLayout): string {
  return layout === "root" ? resolve(cwd) : resolve(cwd, ".context");
}

function hasRootLayoutMarker(dir: string): boolean {
  const configPath = join(dir, "config.yaml");
  if (!existsSync(configPath)) return false;
  try {
    const parsed = YAML.parse(readFileSync(configPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return false;
    const workspace = (parsed as Record<string, unknown>).workspace;
    if (!workspace || typeof workspace !== "object") return false;
    return (workspace as Record<string, unknown>).layout === "root";
  } catch {
    return false;
  }
}

export function findWorkspaceAt(dir: string): WorkspaceLocation | null {
  const root = resolve(dir);
  const embedded = join(root, ".context");
  if (existsSync(join(embedded, "config.yaml")) && isDirectorySafe(embedded)) {
    return { ctxDir: embedded, workspaceRoot: root, layout: "embedded" };
  }
  if (hasRootLayoutMarker(root)) {
    return { ctxDir: root, workspaceRoot: root, layout: "root" };
  }
  return null;
}

export function findNearestWorkspace(startDir: string = process.cwd()): WorkspaceLocation | null {
  let dir = resolve(startDir);
  const { root } = parse(dir);
  while (true) {
    const found = findWorkspaceAt(dir);
    if (found) return found;
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function workspaceLocationFromCtxDir(ctxDir: string): WorkspaceLocation {
  const resolved = resolve(ctxDir);
  if (hasRootLayoutMarker(resolved)) {
    return { ctxDir: resolved, workspaceRoot: resolved, layout: "root" };
  }
  return { ctxDir: resolved, workspaceRoot: dirname(resolved), layout: "embedded" };
}

export function workspaceRootFromCtxDir(ctxDir: string): string {
  return workspaceLocationFromCtxDir(ctxDir).workspaceRoot;
}
