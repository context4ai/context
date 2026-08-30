import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  DEFAULT_FILE_SOURCES_REGISTRY_PATH,
  DEFAULT_LARK_SOURCES_REGISTRY_PATH,
  DEFAULT_REPO_SOURCES_REGISTRY_PATH,
  loadSourcesRegistry,
  type PhaseResourceReference,
  type ProjectSourceDefinition,
} from "@c4a/context";
import YAML from "yaml";
import { applyAtomicFileBatch, type AtomicFileBatchWrite } from "../lib/atomicFileBatch.js";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { readCandidateRecords } from "./candidateLedger.js";
import {
  readDocumentManifestFile,
  removeDocumentSnapshotFromManifestFile,
  renderDocumentManifestFile,
} from "./documentBatchManifest.js";
import { loadContextProjectModule } from "./workspace.js";
import { withProjectWriteLock } from "./writeLock.js";

type SourceKind = "repo" | "file" | "lark";

interface RemovableSource {
  type: SourceKind;
  id: string;
  name: string;
  namespace?: string;
  module?: string;
  materializedAt: string;
  manifest?: string;
}

export interface SourceRemovalCleanup {
  mode: "registry-only" | "document-snapshot" | "exclusive-materialization";
  sharedMaterializedBy: string[];
  manifest?: string;
  manifestEntry?: string;
  filesToRemove: string[];
  directoriesToRemove: string[];
}

export interface SourceRemovalResult {
  action: "preview" | "removed";
  source: RemovableSource;
  registry: string;
  materialized: string;
  references: string[];
  plan_digest: string;
  cleanup: SourceRemovalCleanup;
  next?: string;
}

interface SourceRemovalPlan extends SourceRemovalResult {
  registryWrite: AtomicFileBatchWrite;
  manifestWrite?: AtomicFileBatchWrite;
  absoluteRemovals: string[];
}

function sourceIdentity(source: ProjectSourceDefinition): string | undefined {
  if (source.kind === "source.collection") return undefined;
  return source.name;
}

function resourceReferencesSource(resource: PhaseResourceReference, source: RemovableSource): boolean {
  return resource.kind === "source" && sourceIdentity(resource.source) === source.name;
}

function canonicalSourcePrefix(source: RemovableSource): string {
  return `${source.type}:${source.name}`;
}

function stringReferencesSource(value: string, source: RemovableSource): boolean {
  const prefix = canonicalSourcePrefix(source);
  return value === prefix || value.startsWith(`${prefix}#`);
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, output);
  }
}

async function yamlReferences(input: {
  projectRoot: string;
  path: string;
  source: RemovableSource;
}): Promise<boolean> {
  const absolutePath = join(input.projectRoot, input.path);
  if (!existsSync(absolutePath)) return false;
  const parsed = YAML.parse(await readFile(absolutePath, "utf8")) as unknown;
  const strings: string[] = [];
  collectStrings(parsed, strings);
  return strings.some((value) => stringReferencesSource(value, input.source));
}

async function collectSourceReferences(projectRoot: string, source: RemovableSource): Promise<string[]> {
  const references = new Set<string>();
  const loaded = await loadContextProjectModule(projectRoot);
  loaded.project.sources.forEach((declared, index) => {
    if (sourceIdentity(declared) === source.name) references.add(`project.sources[${index}]`);
  });
  loaded.project.phases.forEach((phase, index) => {
    const direct = "source" in phase && sourceIdentity(phase.source as ProjectSourceDefinition) === source.name;
    const resource = phase.reads.some((read) => resourceReferencesSource(read, source));
    if (direct || resource) references.add(`project.phases[${index}] (${phase.id})`);
  });

  for (const candidate of await readCandidateRecords(projectRoot)) {
    if (
      candidate.source?.name === source.name ||
      candidate.source_refs.some((ref) => stringReferencesSource(ref, source)) ||
      candidate.shared_source_refs?.some((ref) => stringReferencesSource(ref, source)) === true
    ) {
      references.add(`draft candidate ${candidate.candidate_id}`);
    }
  }

  for (const path of [
    "knowledge/structure.yaml",
    ".tmp/context-runtime/lifecycle/structure.yaml",
  ]) {
    if (await yamlReferences({ projectRoot, path, source })) references.add(path);
  }
  return [...references].sort();
}

function registryPath(type: SourceKind): string {
  if (type === "repo") return DEFAULT_REPO_SOURCES_REGISTRY_PATH;
  return type === "file" ? DEFAULT_FILE_SOURCES_REGISTRY_PATH : DEFAULT_LARK_SOURCES_REGISTRY_PATH;
}

async function resolveRemovableSource(projectRoot: string, selector: string): Promise<RemovableSource> {
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const matches: RemovableSource[] = [
    ...registry.repos.map((source) => ({
      type: "repo" as const,
      id: source.id,
      name: source.name,
      namespace: source.namespace,
      module: source.module,
      materializedAt: source.materializedAt,
    })),
    ...registry.files.map((source) => ({
      type: "file" as const,
      id: source.id,
      name: source.name,
      ...(source.namespace !== undefined ? { namespace: source.namespace } : {}),
      ...(source.module !== undefined ? { module: source.module } : {}),
      materializedAt: source.materializedAt,
      ...(source.snapshot?.manifest !== undefined ? { manifest: source.snapshot.manifest } : {}),
    })),
    ...registry.larks.map((source) => ({
      type: "lark" as const,
      id: source.id,
      name: source.name,
      ...(source.namespace !== undefined ? { namespace: source.namespace } : {}),
      ...(source.module !== undefined ? { module: source.module } : {}),
      materializedAt: source.materializedAt,
      ...(source.snapshot?.manifest !== undefined ? { manifest: source.snapshot.manifest } : {}),
    })),
  ].filter((source) => source.id === selector || source.name === selector);
  if (matches.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `source '${selector}' is not registered`, {
      category: ErrorCategory.SourceNotFound,
      sourceId: selector,
    });
  }
  if (matches.length > 1) {
    throw new ContextError(ExitCode.UserError, `source selector '${selector}' is ambiguous`, {
      category: ErrorCategory.UserInputInvalid,
      sourceId: selector,
      matches: matches.map((source) => `${source.type}:${source.name}`),
      next: "Use the full source id returned by context source list --format json.",
    });
  }
  return matches[0]!;
}

function removeDocumentEntry(document: unknown, source: RemovableSource): unknown {
  const record = document !== null && typeof document === "object" && !Array.isArray(document)
    ? document as Record<string, unknown>
    : {};
  const sources = Array.isArray(record.sources) ? record.sources : [];
  const nextSources = sources.flatMap((raw): unknown[] => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [raw];
    const entry = raw as Record<string, unknown>;
    if (source.namespace !== undefined && source.module !== undefined && entry.name === source.namespace && Array.isArray(entry.modules)) {
      const modules = entry.modules.filter((module) => {
        if (module === null || typeof module !== "object" || Array.isArray(module)) return true;
        const moduleRecord = module as Record<string, unknown>;
        return moduleRecord.name !== source.module && moduleRecord.id !== source.module;
      });
      return modules.length > 0 ? [{ ...entry, modules }] : [];
    }
    return entry.name === source.name || entry.id === source.id ? [] : [raw];
  });
  return { ...record, sources: nextSources };
}

async function registryRemovalWrite(projectRoot: string, source: RemovableSource): Promise<AtomicFileBatchWrite> {
  const path = registryPath(source.type);
  const absolutePath = join(projectRoot, path);
  const document = existsSync(absolutePath)
    ? YAML.parse(await readFile(absolutePath, "utf8")) as unknown
    : { sources: [] };
  return {
    path: absolutePath,
    bytes: YAML.stringify(removeDocumentEntry(document, source)),
  };
}

function safeManagedMaterializedPath(projectRoot: string, source: RemovableSource): string | undefined {
  if (isAbsolute(source.materializedAt)) return undefined;
  const absolute = resolve(projectRoot, source.materializedAt);
  const expectedRoot = resolve(projectRoot, "sources", source.type);
  const rel = relative(expectedRoot, absolute);
  if (rel.length === 0 || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return undefined;
  }
  return absolute;
}

function safeManagedManifestPath(projectRoot: string, source: RemovableSource): string {
  const manifest = source.manifest ?? join(source.materializedAt, "manifest.json");
  if (isAbsolute(manifest)) throw unsafeOwnership(source, manifest);
  const absolute = resolve(projectRoot, manifest);
  const expectedRoot = resolve(projectRoot, "sources", source.type);
  const rel = relative(expectedRoot, absolute);
  if (rel.length === 0 || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw unsafeOwnership(source, manifest);
  }
  return absolute;
}

function safeManagedSnapshotChild(projectRoot: string, source: RemovableSource, path: string): string {
  const materializedRoot = safeManagedMaterializedPath(projectRoot, source);
  if (materializedRoot === undefined || isAbsolute(path)) throw unsafeOwnership(source, path);
  const absolute = resolve(materializedRoot, path);
  const rel = relative(materializedRoot, absolute);
  if (rel.length === 0 || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw unsafeOwnership(source, path);
  }
  return absolute;
}

function unsafeOwnership(source: RemovableSource, path: string): ContextError {
  return new ContextError(ExitCode.WorkspaceStateError, `source '${source.name}' has an unsafe managed path`, {
    category: ErrorCategory.WorkspaceStateInvalid,
    code: "source-remove-ownership-invalid",
    source: `${source.type}:${source.name}`,
    path,
    next: "Repair the source registry or snapshot manifest, then preview source removal again.",
  });
}

function projectRelative(projectRoot: string, path: string): string {
  return relative(projectRoot, path).split(sep).join("/");
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

async function sharedMaterializedOwners(projectRoot: string, source: RemovableSource): Promise<string[]> {
  const target = safeManagedMaterializedPath(projectRoot, source);
  if (target === undefined) return [];
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const entries = source.type === "repo"
    ? registry.repos
    : source.type === "file"
      ? registry.files
      : registry.larks;
  return entries
    .filter((entry) => entry.name !== source.name && safeManagedMaterializedPath(projectRoot, {
      type: source.type,
      id: entry.id,
      name: entry.name,
      materializedAt: entry.materializedAt,
    }) === target)
    .map((entry) => `${source.type}:${entry.name}`)
    .sort();
}

function documentOwnedPaths(projectRoot: string, source: RemovableSource, snapshot: {
  files: ReadonlyArray<{ path: string }>;
  assets?: ReadonlyArray<{ path: string }>;
  metadata?: { capture?: { routeFiles?: ReadonlyArray<{ path: string }> } };
}): string[] {
  return [...new Set([
    ...snapshot.files.map((entry) => entry.path),
    ...(snapshot.assets?.map((entry) => entry.path) ?? []),
    ...(snapshot.metadata?.capture?.routeFiles?.map((entry) => entry.path) ?? []),
  ].map((path) => safeManagedSnapshotChild(projectRoot, source, path)))].sort();
}

async function createRemovalPlan(projectRoot: string, selector: string): Promise<SourceRemovalPlan> {
  const source = await resolveRemovableSource(projectRoot, selector);
  const references = await collectSourceReferences(projectRoot, source);
  const registryWrite = await registryRemovalWrite(projectRoot, source);
  const sharedMaterializedBy = await sharedMaterializedOwners(projectRoot, source);
  const absoluteRemovals: string[] = [];
  let manifestWrite: AtomicFileBatchWrite | undefined;
  let cleanup: SourceRemovalCleanup = {
    mode: "registry-only",
    sharedMaterializedBy,
    filesToRemove: [],
    directoriesToRemove: [],
  };

  if (source.type === "file" || source.type === "lark") {
    const manifestPath = safeManagedManifestPath(projectRoot, source);
    let removal;
    try {
      removal = removeDocumentSnapshotFromManifestFile({
        current: await readDocumentManifestFile(manifestPath),
        sourceName: source.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ContextError(ExitCode.WorkspaceStateError, `cannot prove snapshot ownership for '${source.name}': ${message}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        code: "source-remove-ownership-invalid",
        source: `${source.type}:${source.name}`,
        manifest: projectRelative(projectRoot, manifestPath),
        next: "Repair or recapture the source snapshot, then preview source removal again.",
      });
    }
    if (removal.snapshot !== null) {
      absoluteRemovals.push(...documentOwnedPaths(projectRoot, source, removal.snapshot));
      if (removal.next === null) {
        absoluteRemovals.push(manifestPath);
      } else {
        manifestWrite = { path: manifestPath, bytes: renderDocumentManifestFile(removal.next) };
      }
      cleanup = {
        mode: "document-snapshot",
        sharedMaterializedBy,
        manifest: projectRelative(projectRoot, manifestPath),
        manifestEntry: source.name,
        filesToRemove: absoluteRemovals
          .filter((path) => path !== manifestPath)
          .map((path) => projectRelative(projectRoot, path)),
        directoriesToRemove: [],
      };
    }
  } else {
    const materializedPath = safeManagedMaterializedPath(projectRoot, source);
    if (materializedPath !== undefined && sharedMaterializedBy.length === 0 && existsSync(materializedPath)) {
      absoluteRemovals.push(materializedPath);
      cleanup = {
        mode: "exclusive-materialization",
        sharedMaterializedBy,
        filesToRemove: [],
        directoriesToRemove: [projectRelative(projectRoot, materializedPath)],
      };
    }
  }

  const planDigest = digest({
    source,
    registry: registryPath(source.type),
    registryBytes: registryWrite.bytes,
    references,
    cleanup,
    manifestBytes: manifestWrite?.bytes ?? null,
  });
  const next = references.length > 0
    ? `Remove all listed references, then preview context source remove '${source.id}' --format json again.`
    : `context source remove '${source.id}' --yes --plan-digest '${planDigest}' --format json`;
  return {
    action: "preview",
    source,
    registry: registryPath(source.type),
    materialized: source.materializedAt,
    references,
    plan_digest: planDigest,
    cleanup,
    next,
    registryWrite,
    ...(manifestWrite !== undefined ? { manifestWrite } : {}),
    absoluteRemovals: [...new Set(absoluteRemovals)].sort(),
  };
}

function publicRemovalResult(plan: SourceRemovalPlan, action: SourceRemovalResult["action"]): SourceRemovalResult {
  return {
    action,
    source: plan.source,
    registry: plan.registry,
    materialized: plan.materialized,
    references: plan.references,
    plan_digest: plan.plan_digest,
    cleanup: plan.cleanup,
    ...(action === "preview" && plan.next !== undefined ? { next: plan.next } : {}),
  };
}

async function pruneExtractRuntime(projectRoot: string, source: RemovableSource): Promise<void> {
  const fingerprintPath = join(projectRoot, ".tmp/context-runtime/extract/source-fingerprints.json");
  const removedPhaseIds = new Set<string>();
  if (existsSync(fingerprintPath)) {
    const parsed = JSON.parse(await readFile(fingerprintPath, "utf8")) as { version?: unknown; phases?: Record<string, unknown> };
    const phases = parsed.phases ?? {};
    const next = Object.fromEntries(Object.entries(phases).filter(([phaseId, raw]) => {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return true;
      const sources = (raw as { sources?: unknown }).sources;
      const keep = !Array.isArray(sources) || !sources.some((entry) =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry) &&
        (entry as { name?: unknown }).name === source.name
      );
      if (!keep) removedPhaseIds.add(phaseId);
      return keep;
    }));
    await atomicWriteFile(fingerprintPath, `${JSON.stringify({ ...parsed, phases: next }, null, 2)}\n`);
  }

  const phaseOwnershipPath = join(projectRoot, ".tmp/context-runtime/extract/custom-phase-candidates.json");
  if (existsSync(phaseOwnershipPath) && removedPhaseIds.size > 0) {
    const parsed = JSON.parse(await readFile(phaseOwnershipPath, "utf8")) as {
      phases?: Record<string, unknown>;
    };
    const phases = Object.fromEntries(Object.entries(parsed.phases ?? {})
      .filter(([phaseId]) => !removedPhaseIds.has(phaseId)));
    await atomicWriteFile(phaseOwnershipPath, `${JSON.stringify({ ...parsed, phases }, null, 2)}\n`);
  }

  const symbolPath = join(projectRoot, ".tmp/context-runtime/extract/source-symbols.json");
  if (existsSync(symbolPath)) {
    const parsed = JSON.parse(await readFile(symbolPath, "utf8")) as {
      symbols?: unknown[];
      phaseFingerprints?: Record<string, string>;
    };
    const symbols = Array.isArray(parsed.symbols)
      ? parsed.symbols.filter((entry) =>
          entry === null || typeof entry !== "object" || Array.isArray(entry) ||
          (entry as { source?: unknown }).source !== source.name
        )
      : [];
    const phaseFingerprints = Object.fromEntries(Object.entries(parsed.phaseFingerprints ?? {})
      .filter(([phaseId]) => !removedPhaseIds.has(phaseId)));
    await atomicWriteFile(symbolPath, `${JSON.stringify({ ...parsed, phaseFingerprints, symbols }, null, 2)}\n`);
  }

  const snapshotRoot = join(projectRoot, ".tmp/context-runtime/extract/candidates");
  const visit = async (directory: string): Promise<void> => {
    if (!existsSync(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as { source?: unknown; source_refs?: unknown };
        const refs = Array.isArray(parsed.source_refs) ? parsed.source_refs : [];
        if (parsed.source === source.name || refs.some((ref) => typeof ref === "string" && stringReferencesSource(ref, source))) {
          await rm(path, { force: true });
        }
      } catch {
        // Invalid snapshots are handled by Review; source removal never guesses ownership.
      }
    }
  };
  await visit(snapshotRoot);
}

export async function removeProjectSource(input: {
  projectRoot: string;
  selector: string;
  apply: boolean;
  planDigest?: string;
}): Promise<SourceRemovalResult> {
  if (!input.apply) {
    return publicRemovalResult(await createRemovalPlan(input.projectRoot, input.selector), "preview");
  }
  if (input.planDigest === undefined) {
    throw new ContextError(ExitCode.UserError, "source removal requires a digest-bound preview", {
      category: ErrorCategory.UserInputInvalid,
      code: "source-remove-plan-required",
      next: `Run context source remove '${input.selector}' --format json, inspect cleanup, then execute its next command.`,
    });
  }
  return withProjectWriteLock(input.projectRoot, "source-remove", async () => {
    const plan = await createRemovalPlan(input.projectRoot, input.selector);
    if (plan.plan_digest !== input.planDigest) {
      throw new ContextError(ExitCode.WorkspaceStateError, "source removal preview is stale", {
        category: ErrorCategory.WorkspaceStateInvalid,
        code: "source-remove-plan-stale",
        expected: input.planDigest,
        actual: plan.plan_digest,
        next: `Run context source remove '${plan.source.id}' --format json again and inspect the new cleanup plan.`,
      });
    }
    if (plan.references.length > 0) {
      throw new ContextError(ExitCode.WorkspaceStateError, `source '${plan.source.name}' is still referenced`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        code: "source-remove-referenced",
        source: `${plan.source.type}:${plan.source.name}`,
        references: plan.references,
        next: `Remove the listed project/candidate/knowledge references, then preview context source remove '${plan.source.id}' --format json again.`,
      });
    }
    await applyAtomicFileBatch({
      transactionRoot: join(input.projectRoot, ".tmp", "context-runtime", "source-remove-transactions"),
      writes: [plan.registryWrite, ...(plan.manifestWrite !== undefined ? [plan.manifestWrite] : [])],
      removals: plan.absoluteRemovals,
    });
    await pruneExtractRuntime(input.projectRoot, plan.source);
    return publicRemovalResult(plan, "removed");
  });
}
