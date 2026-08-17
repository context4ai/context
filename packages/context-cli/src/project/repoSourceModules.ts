import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_PATH_FILTER } from "@c4a/core";
import { detectModuleBoundaries, type ModuleBoundaryResult } from "@c4a/extract";
import type { RepoSourceRecord } from "./repoSourceRegistry.js";
import type { RepoSourceStatus } from "./repoSources.js";

export interface RepoSourceModuleSuggestion {
  module: string;
  local: string;
  command: string;
}

export interface RepoSourceModuleInspectResult {
  source: RepoSourceRecord;
  status: RepoSourceStatus;
  modules: ModuleBoundaryResult[];
  moduleCount: number;
  recommended_sources: RepoSourceModuleSuggestion[];
  agent_hints: string[];
}

function normalizeSubpath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");
  return normalized.length > 0 ? normalized : undefined;
}

function sourceScopedLocalForDisplay(source: RepoSourceRecord, status: RepoSourceStatus): string {
  const base = source.local ?? status.materializedAt;
  const subpath = normalizeSubpath(source.subpath);
  return subpath === undefined ? base : `${base.replace(/\/+$/u, "")}/${subpath}`;
}

function sourceModuleLocalForDisplay(input: {
  source: RepoSourceRecord;
  status: RepoSourceStatus;
  module: ModuleBoundaryResult;
}): string {
  const scoped = sourceScopedLocalForDisplay(input.source, input.status).replace(/\/+$/u, "");
  return input.module.path === "." ? scoped : `${scoped}/${input.module.path}`;
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/u.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function suggestedModuleName(module: ModuleBoundaryResult): string {
  const unscoped = module.name.replace(/^@[^/]+\//u, "");
  const slug = unscoped
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || "module";
}

export async function inspectRepoSourceModules(input: {
  projectRoot: string;
  source: RepoSourceRecord;
  status: RepoSourceStatus;
  scopedAbs: string | null;
}): Promise<RepoSourceModuleInspectResult> {
  const inspectPath = input.scopedAbs !== null && existsSync(input.scopedAbs)
    ? input.scopedAbs
    : join(input.projectRoot, input.status.materializedAt);
  const modules = existsSync(inspectPath)
    ? await detectModuleBoundaries(inspectPath, input.status.head ?? input.status.ref, DEFAULT_PATH_FILTER)
    : [];
  const recommended_sources = modules
    .filter((module) => module.path !== "." || modules.length === 1)
    .map((module) => {
      const local = sourceModuleLocalForDisplay({ source: input.source, status: input.status, module });
      return {
        module: module.name,
        local,
        command: `context source add repo ${input.source.namespace} --module ${suggestedModuleName(module)} --local ${shellQuote(local)}`,
      };
    });
  const agent_hints = modules.length > 1
    ? ["source-boundary-confirmation-required"]
    : ["single-module-boundary"];
  return {
    source: input.source,
    status: input.status,
    modules,
    moduleCount: modules.length,
    recommended_sources,
    agent_hints,
  };
}

export function resolveRepoSourceLocalPath(projectRoot: string, local: string | undefined): string | null {
  if (!local) return null;
  return resolve(projectRoot, local);
}

export function resolveRepoSourceScopedPath(localAbs: string, subpath: string | undefined): string {
  const normalized = normalizeSubpath(subpath);
  return normalized === undefined ? localAbs : resolve(localAbs, normalized);
}
