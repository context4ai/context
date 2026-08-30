import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { CodeIndexOutputProfile } from "@c4a/context";
import type {
  ExtractionStructuralProbe,
  SourceSelection,
} from "./extractCandidateTypes.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".tmp",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);
const MAX_DISCOVERED_FILES = 20_000;
const MAX_PROBE_PATHS = 12;

async function discoverFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (files.length >= MAX_DISCOVERED_FILES) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= MAX_DISCOVERED_FILES) return;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(join(directory, entry.name));
      } else if (entry.isFile()) {
        files.push(relative(root, join(directory, entry.name)).replaceAll("\\", "/"));
      }
    }
  };
  await visit(root);
  return files;
}

function limited(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort().slice(0, MAX_PROBE_PATHS);
}

function prioritizedPaths(authoritative: readonly string[], heuristic: readonly string[]): string[] {
  const required = [...new Set(authoritative)].sort();
  const optional = [...new Set(heuristic)]
    .filter((path) => !required.includes(path))
    .sort()
    .slice(0, Math.max(0, MAX_PROBE_PATHS - required.length));
  return [...required, ...optional];
}

function values(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(values);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(values);
  }
  return [];
}

async function packageFacts(root: string): Promise<{
  entries: string[];
  dependencies: Set<string>;
}> {
  const path = join(root, "package.json");
  if (!existsSync(path)) return { entries: [], dependencies: new Set() };
  try {
    const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const dependencyFields = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ].filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
    return {
      entries: [...new Set([manifest.main, manifest.module, manifest.types, manifest.bin, manifest.exports]
        .flatMap(values)
        .map((entry) => entry.replace(/^\.\//u, "")))].sort(),
      dependencies: new Set(dependencyFields.flatMap((field) => Object.keys(field))),
    };
  } catch {
    return { entries: [], dependencies: new Set() };
  }
}

function probe(input: Omit<ExtractionStructuralProbe, "id">): ExtractionStructuralProbe {
  return {
    ...input,
    id: `${input.source}:${input.capability}:${input.kind}`,
  };
}

function implementationPaths(files: readonly string[], extensions: RegExp): string[] {
  return limited(files.filter((path) =>
    extensions.test(path) &&
    /(?:^|\/)(?:controller|handler|hook|page|repository|repo|service|usecase)s?(?:\/|\.)/iu.test(path) &&
    !/(?:^|\/)(?:__tests__|fixtures|generated|mocks)(?:\/|$)|\.(?:test|spec)\./iu.test(path)
  ));
}

function commonEntries(files: readonly string[], pattern: RegExp): string[] {
  return limited(files.filter((path) =>
    pattern.test(path) &&
    /(?:^|\/)(?:index|main|app|server|cli|router)(?:\.[^/]+)$/iu.test(path)
  ));
}

function profiles(...items: CodeIndexOutputProfile[]): CodeIndexOutputProfile[] {
  return items;
}

async function probeSource(input: {
  projectRoot: string;
  source: SourceSelection;
}): Promise<ExtractionStructuralProbe[]> {
  const root = join(input.projectRoot, input.source.status.materializedAt);
  const source = input.source.record.name;
  const files = await discoverFiles(root);
  const packageInfo = await packageFacts(root);
  const probes: ExtractionStructuralProbe[] = [];
  const scriptFiles = files.filter((path) => /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/iu.test(path));
  const goFiles = files.filter((path) => /\.go$/iu.test(path) && !/(?:^|\/)(?:vendor|generated)(?:\/|$)|_test\.go$/iu.test(path));

  if (existsSync(join(root, "package.json")) && scriptFiles.length > 0) {
    const manifestEntries = packageInfo.entries.filter((path) => files.includes(path));
    const entries = prioritizedPaths(manifestEntries, [
      ...commonEntries(scriptFiles, /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/iu),
      ...(scriptFiles.length > 0 ? [scriptFiles[0]!] : []),
    ]);
    probes.push(probe({
      source,
      capability: "typescript-symbols",
      kind: "entry",
      paths: entries,
      profiles: profiles("public-api-reference", "module-map", "application-map", "adapter-contract", "command-map"),
      summary: "Probe stable JavaScript/TypeScript entry symbols with the community TypeScript extractor.",
    }));
    const implementations = implementationPaths(scriptFiles, /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/iu);
    if (implementations.length > 0) probes.push(probe({
      source,
      capability: "typescript-symbols",
      kind: "implementation",
      paths: implementations,
      profiles: profiles("module-map", "application-map", "service-boundary", "runtime-map", "protocol-index", "cross-module-flow"),
      summary: "Probe representative implementation boundaries instead of rendering only an entry card.",
    }));
  }

  const usesReactRouter = [...packageInfo.dependencies].some((name) =>
    name === "react-router" || name === "react-router-dom"
  );
  if (usesReactRouter) {
    const routePaths = limited(scriptFiles.filter((path) => /(?:^|\/)(?:route|router|routes)(?:\.|\/)/iu.test(path)));
    if (routePaths.length > 0) probes.push(probe({
      source,
      capability: "react-router-routes",
      kind: "route",
      paths: routePaths,
      profiles: profiles("application-map", "protocol-index", "module-map", "cross-module-flow"),
      summary: "Probe declared route structure with the community React Router extractor.",
    }));
  }

  if (existsSync(join(root, "go.mod")) && goFiles.length > 0) {
    const entries = limited([
      ...commonEntries(goFiles, /\.go$/iu),
      ...(goFiles.length > 0 ? [goFiles[0]!] : []),
    ]);
    probes.push(probe({
      source,
      capability: "go-symbols",
      kind: "entry",
      paths: entries,
      profiles: profiles("module-map", "service-boundary", "runtime-map", "protocol-index", "command-map"),
      summary: "Probe stable Go entries with the community Go structural extractor.",
    }));
    const implementations = implementationPaths(goFiles, /\.go$/iu);
    if (implementations.length > 0) probes.push(probe({
      source,
      capability: "go-symbols",
      kind: "implementation",
      paths: implementations,
      profiles: profiles("module-map", "service-boundary", "runtime-map", "protocol-index", "cross-module-flow"),
      summary: "Probe representative Go handler, service, use-case, or repository boundaries.",
    }));
  }

  if (existsSync(join(root, "rush.json"))) probes.push(probe({
    source,
    capability: "rush-workspace",
    kind: "workspace",
    paths: ["rush.json"],
    profiles: profiles("module-registry", "module-map", "public-api-reference"),
    summary: "Probe workspace projects and dependency edges with the community Rush extractor.",
  }));

  const protocols = limited(files.filter((path) =>
    /(?:^|\/)(?:openapi|swagger)(?:\.|\/)|\.(?:proto|thrift)$/iu.test(path)
  ));
  if (protocols.length > 0) probes.push(probe({
    source,
    capability: "protocol-schema",
    kind: "protocol",
    paths: protocols,
    profiles: profiles("protocol-index", "service-boundary", "adapter-contract", "application-map", "module-map", "cross-module-flow"),
    summary: "Probe source-owned protocol schemas before aggregating the public boundary.",
  }));
  return probes.filter((item) => item.paths.length > 0);
}

export async function probeStructuralCapabilities(input: {
  projectRoot: string;
  sources: readonly SourceSelection[];
}): Promise<ExtractionStructuralProbe[]> {
  const results: ExtractionStructuralProbe[] = [];
  for (const source of input.sources) {
    results.push(...await probeSource({ projectRoot: input.projectRoot, source }));
  }
  return results.sort((left, right) => left.id.localeCompare(right.id));
}

export function probesForIndexUnit(input: {
  probes: readonly ExtractionStructuralProbe[];
  inputSources: readonly string[];
  outputProfile: CodeIndexOutputProfile;
  entries?: readonly string[];
}): ExtractionStructuralProbe[] {
  return input.probes
    .filter((item) => input.inputSources.includes(item.source) && item.profiles.includes(input.outputProfile))
    .map((item) => item.capability === "typescript-symbols" && item.kind === "entry"
      ? { ...item, paths: prioritizedPaths(input.entries ?? [], item.paths) }
      : item);
}
