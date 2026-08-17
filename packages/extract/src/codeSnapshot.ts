import { contentHash, encodeVersionLabel } from "@c4a/core";
import { generateDigest } from "./digest.js";
import type { DigestData, ExtractionResult, RelationInfo, SymbolInfo } from "./types.js";
import type { RepositoryExtractionModuleResult } from "./repository.js";

export interface FlatSymbolRow extends Omit<SymbolInfo, "members"> {
  package: string;
  package_name: string;
  symbol_id: string;
  modulePath: string;
  module_path: string;
}

export interface CodePackageRow {
  name: string;
  kind: string;
  language: string;
  modulePath: string;
  hash_id: string;
  version?: string;
  description?: string;
}

export interface CodeEdgeRow extends RelationInfo {
  package: string;
  package_name: string;
  modulePath: string;
  module_path: string;
  version_label: string;
  hash_id: string;
}

export type CodeVersionSource = "explicit" | "package-json" | "fallback-0.0.1";

export interface CodeDigestRow {
  hash_id: string;
  module_name: string;
  module_path: string;
  package_name: string;
  dir_commit: string;
  version_label: string;
  version_source: CodeVersionSource;
  module_content_hash: string;
  dirty: boolean;
  doc?: string;
  digest: DigestData;
}

export interface CodeSourceFileRow {
  source_id: string;
  source_path: string;
  hash_id: string;
  digest_hash_id: string;
  version_label: string;
  version_source: CodeVersionSource;
  branch: string | null;
  package_name: string;
  module_path: string;
}

export interface CodeSnapshotManifest {
  snapshot_id: string;
  source_id: string;
  source_slug: string;
  source_type: "aspect-code";
  captured_at: string;
  code_snapshot_contract_version: string;
  head_commit: string | null;
  dirty: boolean;
  script_hash: string;
  toolchain: CodeSnapshotToolchain;
  version_policy: CodeSourceManifest["version_policy"];
  version_label?: string;
  version_source?: CodeVersionSource | "mixed";
  snapshot_content_hash: string;
  worktree_content_hash?: string;
  total_bytes: number;
  module_count: number;
  symbol_count: number;
  edge_count: number;
}

export const CODE_SNAPSHOT_META_SCHEMA_VERSION = "code.snapshot.meta.v2";

export interface CodeSnapshotMeta {
  schema_version: typeof CODE_SNAPSHOT_META_SCHEMA_VERSION;
  source_id: string;
  aspect: "code";
  commit: string | null;
  captured_at: string;
  script_hash: string;
  content_hash: string;
  inputs: Array<{
    module_path: string;
    package_name: string;
    hash_id: string;
    digest_hash_id: string;
    dir_commit: string;
    module_content_hash: string;
    dirty: boolean;
    version_label: string;
    version_source: CodeVersionSource;
  }>;
  snapshot_id: string;
  source_slug: string;
  code_snapshot_contract_version: string;
  snapshot_content_hash: string;
  toolchain: CodeSnapshotToolchain;
  version_policy: CodeSourceManifest["version_policy"];
  version_label?: string;
  version_source?: CodeVersionSource | "mixed";
  head_commit: string | null;
  dirty: boolean;
  worktree_content_hash?: string;
}

export interface CodeSnapshotToolchain {
  manager_package: string;
  manager_version: string;
  runner_package: string;
  runner_package_version: string;
  runner_bin: string;
  plugin_package: string;
  plugin_package_version: string;
  plugin_export: string;
}

export interface CodeSourceManifest {
  source_id: string;
  source_slug: string;
  source_type: "aspect-code";
  repo_path: string;
  origin_path: string;
  snapshot_id: string;
  snapshot_content_hash: string;
  code_snapshot_contract_version: string;
  toolchain: CodeSnapshotToolchain;
  version_policy: "package-version" | "module-commit" | "explicit" | "none";
  version_label?: string;
  version_source?: CodeVersionSource | "mixed";
  captured_at: string;
}

export interface CodeSnapshotRows {
  packages: CodePackageRow[];
  symbols: FlatSymbolRow[];
  edges: CodeEdgeRow[];
  digests: CodeDigestRow[];
  sourceFiles: CodeSourceFileRow[];
}

export interface BuildDigestDataInput {
  moduleName: string;
  modulePath: string;
  extraction: ExtractionResult;
  dirCommit: string;
  versionLabel?: string | null;
  versionSource?: CodeVersionSource;
  moduleDoc?: string;
  dirty?: boolean;
}

export interface BuildCodeSnapshotInput {
  sourceId: string;
  sourceSlug: string;
  snapshotId: string;
  repoPath: string;
  sourceCommit?: string | null;
  originPath?: string;
  capturedAt?: string;
  codeSnapshotContractVersion: string;
  scriptHash: string;
  toolchain: CodeSnapshotToolchain;
  versionPolicy?: "package-version" | "module-commit" | "explicit" | "none";
  dirCommits?: Record<string, string | null | undefined>;
  versionLabels?: Record<string, string | null | undefined>;
  versionSources?: Record<string, CodeVersionSource | undefined>;
  dirtyModules?: Record<string, boolean | undefined>;
  worktreeContentHash?: string;
  results: RepositoryExtractionModuleResult[];
}

export interface CodeSnapshotPayload {
  source: CodeSourceManifest;
  manifest: CodeSnapshotManifest;
  rows: CodeSnapshotRows;
  files: Record<string, string>;
}

const sha256 = (value: string): string => `sha256:${contentHash(value)}`;
const FALLBACK_VERSION_LABEL = "0.0.1";

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof RegExp) return JSON.stringify(value.toString());
  if (value instanceof Set) {
    const items = Array.from(value).map((item) => stableStringify(item)).sort((left, right) => left.localeCompare(right));
    return `{"$set":[${items.join(",")}]}`;
  }
  if (value instanceof Map) {
    const entries = Array.from(value.entries())
      .map(([key, item]) => [stableStringify(key), stableStringify(item)] as const)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `[${key},${item}]`);
    return `{"$map":[${entries.join(",")}]}`;
  }
  const objectValue = value as Record<string, unknown>;
  const entries = Object.keys(objectValue)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`);
  return `{${entries.join(",")}}`;
};

export const hashStable = (value: unknown): string => sha256(stableStringify(value));

export const jsonl = (rows: unknown[]): string =>
  rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "");

export const manifestText = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

export const canonicalizeCodeVersionLabel = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || encodeVersionLabel(trimmed) === null) return null;
  return trimmed.replace(/^v/iu, "").replace(/-(alpha|beta|rc)\./iu, (match) => match.toLowerCase());
};

const normalizeDoc = (value: string | null | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\r\n?/gu, "\n").replace(/[ \t]+$/gmu, "").trim();
  return normalized.length > 0 ? normalized : undefined;
};

const resolveVersion = (
  label: string | null | undefined,
  source: CodeVersionSource | undefined,
): { version_label: string; version_source: CodeVersionSource } => {
  const canonical = typeof label === "string" ? canonicalizeCodeVersionLabel(label) : null;
  if (canonical) {
    return { version_label: canonical, version_source: source ?? "package-json" };
  }
  return { version_label: FALLBACK_VERSION_LABEL, version_source: "fallback-0.0.1" };
};

const commonVersionField = <T extends "version_label" | "version_source">(
  rows: CodeDigestRow[],
  field: T,
): CodeDigestRow[T] | "mixed" | undefined => {
  const values = new Set(rows.map((row) => row[field]));
  if (values.size === 0) return undefined;
  return values.size === 1 ? Array.from(values)[0]! : "mixed";
};

const commonCommit = (rows: CodeSnapshotRows): string | null => {
  const commits = new Set(rows.digests.map((row) => row.dir_commit).filter((commit) => commit && commit !== "unknown"));
  return commits.size === 1 ? Array.from(commits)[0]! : null;
};

export const metaText = (
  manifest: CodeSnapshotManifest,
  source: CodeSourceManifest,
  rows: CodeSnapshotRows,
): string => {
  const digestByModule = new Map(rows.digests.map((row) => [row.module_path, row]));
  const meta: CodeSnapshotMeta = {
    schema_version: CODE_SNAPSHOT_META_SCHEMA_VERSION,
    source_id: manifest.source_id,
    aspect: "code",
    commit: commonCommit(rows),
    captured_at: manifest.captured_at,
    script_hash: manifest.script_hash,
    content_hash: manifest.snapshot_content_hash,
    inputs: rows.sourceFiles.map((row) => ({
      module_path: row.module_path,
      package_name: row.package_name,
      hash_id: row.hash_id,
      digest_hash_id: row.digest_hash_id,
      dir_commit: digestByModule.get(row.module_path)?.dir_commit ?? "unknown",
      module_content_hash: digestByModule.get(row.module_path)?.module_content_hash ?? "",
      dirty: digestByModule.get(row.module_path)?.dirty ?? false,
      version_label: row.version_label,
      version_source: row.version_source,
    })),
    snapshot_id: manifest.snapshot_id,
    source_slug: manifest.source_slug,
    code_snapshot_contract_version: manifest.code_snapshot_contract_version,
    snapshot_content_hash: manifest.snapshot_content_hash,
    toolchain: manifest.toolchain,
    version_policy: source.version_policy,
    ...(manifest.version_label ? { version_label: manifest.version_label } : {}),
    ...(manifest.version_source ? { version_source: manifest.version_source } : {}),
    head_commit: manifest.head_commit,
    dirty: manifest.dirty,
    ...(manifest.worktree_content_hash ? { worktree_content_hash: manifest.worktree_content_hash } : {}),
  };
  return manifestText(meta);
};

export function flattenSymbols(
  symbols: SymbolInfo[],
  packageName: string,
  modulePath: string,
): FlatSymbolRow[] {
  const out: FlatSymbolRow[] = [];
  const walk = (list: SymbolInfo[]) => {
    for (const symbol of list) {
      const { members, ...rest } = symbol;
      out.push({
        ...rest,
        package: packageName,
        package_name: packageName,
        symbol_id: symbol.name,
        modulePath,
        module_path: modulePath,
      });
      if (members && members.length > 0) walk(members);
    }
  };
  walk(symbols);
  return out;
}

export const buildHashId = (
  packageName: string,
  dirCommit: string,
  moduleContentHash?: string,
  dirty = false,
): string => {
  const base = dirty && moduleContentHash
    ? `pkg:${packageName}:${dirCommit}:dirty:${moduleContentHash}`
    : `pkg:${packageName}:${dirCommit}`;
  return sha256(base);
};

export const buildSourceFileHashId = (
  packageName: string,
  sourceCommit: string | null | undefined,
): string => sha256(`pkg:${packageName}:${sourceCommit ?? "unknown"}`);

export const buildPackageHashId = (
  packageName: string,
  modulePath: string,
  version: string | undefined,
  description: string | undefined,
): string => hashStable({ packageName, modulePath, version: version ?? null, description: description ?? null });

export const buildEdgeHashId = (
  edge: RelationInfo,
  packageName: string,
  modulePath: string,
  versionLabel: string,
): string => hashStable({
  packageName,
  modulePath,
  type: edge.type,
  from: edge.from,
  to: edge.to,
  isExternal: edge.isExternal,
  grounding: edge.grounding,
  source: edge.source,
  line: edge.line ?? null,
  versionLabel,
});

export const buildDigestData = (input: BuildDigestDataInput): CodeDigestRow => {
  const digest = generateDigest(input.extraction);
  const moduleContentHash = hashStable(digest);
  const dirty = input.dirty ?? false;
  const rawVersionLabel = input.versionLabel !== undefined ? input.versionLabel : input.extraction.package.version;
  const version = resolveVersion(rawVersionLabel, input.versionSource);
  const doc = normalizeDoc(input.moduleDoc);
  return {
    hash_id: buildHashId(input.extraction.package.name, input.dirCommit, moduleContentHash, dirty),
    module_name: input.moduleName,
    module_path: input.modulePath,
    package_name: input.extraction.package.name,
    dir_commit: input.dirCommit,
    ...version,
    module_content_hash: moduleContentHash,
    dirty,
    ...(doc ? { doc } : {}),
    digest,
  };
};

const packageDescriptionFor = (result: RepositoryExtractionModuleResult): string | undefined => {
  const packageManifest = result.sourceInfo.manifests.find((manifest) => manifest.type === "package.json");
  const content = packageManifest?.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return undefined;
  return normalizeDoc((content as { description?: unknown }).description as string | undefined);
};

const packageRowFor = (result: RepositoryExtractionModuleResult): CodePackageRow => {
  const version = result.extraction.package.version;
  const description = packageDescriptionFor(result);
  return {
    name: result.extraction.package.name,
    kind: result.extraction.package.kind,
    language: result.extraction.package.language,
    modulePath: result.module.path,
    hash_id: buildPackageHashId(result.extraction.package.name, result.module.path, version, description),
    ...(version ? { version } : {}),
    ...(description ? { description } : {}),
  };
};

const edgeRowsFor = (result: RepositoryExtractionModuleResult, versionLabel: string): CodeEdgeRow[] =>
  result.extraction.relations.map((edge) => ({
    ...edge,
    package: result.extraction.package.name,
    package_name: result.extraction.package.name,
    modulePath: result.module.path,
    module_path: result.module.path,
    version_label: versionLabel,
    hash_id: buildEdgeHashId(edge, result.extraction.package.name, result.module.path, versionLabel),
  }));

const byteLength = (value: string): number => Buffer.byteLength(value, "utf-8");

const edgeSortKey = (edge: CodeEdgeRow): string =>
  [
    edge.modulePath,
    edge.from,
    edge.type,
    edge.to,
    edge.line == null ? "" : String(edge.line).padStart(12, "0"),
    edge.source,
    edge.grounding,
    String(edge.isExternal),
    edge.hash_id,
  ].join("\0");

export const buildCodeSnapshot = (input: BuildCodeSnapshotInput): CodeSnapshotPayload => {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const rows: CodeSnapshotRows = {
    packages: [],
    symbols: [],
    edges: [],
    digests: [],
    sourceFiles: [],
  };

  for (const result of input.results) {
    const dirCommit = input.dirCommits?.[result.module.path] ?? result.extraction.meta.commitHash ?? "unknown";
    const versionLabel = input.versionLabels && hasOwn(input.versionLabels, result.module.path)
      ? input.versionLabels[result.module.path] ?? null
      : result.extraction.package.version ?? null;
    const versionSource = input.versionSources && hasOwn(input.versionSources, result.module.path)
      ? input.versionSources[result.module.path]
      : undefined;
    const dirty = input.dirtyModules?.[result.module.path] ?? false;
    const digestRow = buildDigestData({
      moduleName: result.module.name,
      modulePath: result.module.path,
      extraction: result.extraction,
      dirCommit,
      versionLabel,
      ...(versionSource ? { versionSource } : {}),
      ...(result.moduleDoc ? { moduleDoc: result.moduleDoc } : {}),
      dirty,
    });

    rows.packages.push(packageRowFor(result));
    rows.symbols.push(...flattenSymbols(result.extraction.symbols, result.extraction.package.name, result.module.path));
    rows.edges.push(...edgeRowsFor(result, digestRow.version_label));
    rows.digests.push(digestRow);
    rows.sourceFiles.push({
      source_id: input.sourceId,
      source_path: result.module.path,
      hash_id: buildSourceFileHashId(result.extraction.package.name, input.sourceCommit),
      digest_hash_id: digestRow.hash_id,
      version_label: digestRow.version_label,
      version_source: digestRow.version_source,
      branch: null,
      package_name: result.extraction.package.name,
      module_path: result.module.path,
    });
  }

  rows.packages.sort((left, right) => left.modulePath.localeCompare(right.modulePath));
  rows.symbols.sort((left, right) => `${left.modulePath}:${left.name}:${left.file}:${left.line}`.localeCompare(
    `${right.modulePath}:${right.name}:${right.file}:${right.line}`,
  ));
  rows.edges.sort((left, right) => edgeSortKey(left).localeCompare(edgeSortKey(right)));
  rows.digests.sort((left, right) => left.module_path.localeCompare(right.module_path));
  rows.sourceFiles.sort((left, right) => left.module_path.localeCompare(right.module_path));

  const sourceHashInput = {
    source_id: input.sourceId,
    source_slug: input.sourceSlug,
    repo_path: input.repoPath,
    source_commit: input.sourceCommit ?? null,
    version_policy: input.versionPolicy ?? "package-version",
    rows,
  };
  const snapshotContentHash = hashStable(sourceHashInput);
  const dirty = rows.digests.some((row) => row.dirty);
  const source: CodeSourceManifest = {
    source_id: input.sourceId,
    source_slug: input.sourceSlug,
    source_type: "aspect-code",
    repo_path: input.repoPath,
    origin_path: input.originPath ?? input.repoPath,
    snapshot_id: input.snapshotId,
    snapshot_content_hash: snapshotContentHash,
    code_snapshot_contract_version: input.codeSnapshotContractVersion,
    toolchain: input.toolchain,
    version_policy: input.versionPolicy ?? "package-version",
    captured_at: capturedAt,
  };
  const commonVersionLabel = commonVersionField(rows.digests, "version_label");
  const commonVersionSource = commonVersionField(rows.digests, "version_source");
  if (commonVersionLabel && commonVersionLabel !== "mixed") {
    source.version_label = commonVersionLabel;
  }
  if (commonVersionSource) {
    source.version_source = commonVersionSource;
  }

  const files: Record<string, string> = {
    "source.yaml": manifestText(source),
    "digests.jsonl": jsonl(rows.digests),
    "source-files.jsonl": jsonl(rows.sourceFiles),
    "packages.jsonl": jsonl(rows.packages),
    "symbols.jsonl": jsonl(rows.symbols),
    "edges.jsonl": jsonl(rows.edges),
  };

  const manifestWithoutBytes: Omit<CodeSnapshotManifest, "total_bytes"> = {
    snapshot_id: input.snapshotId,
    source_id: input.sourceId,
    source_slug: input.sourceSlug,
    source_type: "aspect-code",
    captured_at: capturedAt,
    code_snapshot_contract_version: input.codeSnapshotContractVersion,
    head_commit: input.sourceCommit ?? null,
    dirty,
    script_hash: input.scriptHash,
    toolchain: input.toolchain,
    version_policy: source.version_policy,
    ...(source.version_label ? { version_label: source.version_label } : {}),
    ...(source.version_source ? { version_source: source.version_source } : {}),
    snapshot_content_hash: snapshotContentHash,
    ...(input.worktreeContentHash ? { worktree_content_hash: input.worktreeContentHash } : {}),
    module_count: rows.packages.length,
    symbol_count: rows.symbols.length,
    edge_count: rows.edges.length,
  };
  let manifest: CodeSnapshotManifest = { ...manifestWithoutBytes, total_bytes: 0 };
  let converged = false;
  for (let i = 0; i < 50; i++) {
    files["manifest.json"] = manifestText(manifest);
    files["_meta.yaml"] = metaText(manifest, source, rows);
    const totalBytes = Object.values(files).reduce((sum, content) => sum + byteLength(content), 0);
    if (totalBytes === manifest.total_bytes) {
      converged = true;
      break;
    }
    manifest = { ...manifestWithoutBytes, total_bytes: totalBytes };
  }
  if (!converged) {
    throw new Error("code snapshot manifest total_bytes did not converge");
  }
  files["manifest.json"] = manifestText(manifest);
  files["_meta.yaml"] = metaText(manifest, source, rows);

  return { source, manifest, rows, files };
};
