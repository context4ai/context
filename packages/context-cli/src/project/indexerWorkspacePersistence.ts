import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  compareIndexerCanonicalText,
  indexerProtocolDigest,
  indexerRegistryDigests,
  parseIndexerRegistry,
  type IndexerRegistry,
} from "@c4a/context";

export interface IndexerWorkspacePersistenceReport {
  protocol: "context.indexer.workspace-persistence-report/v1";
  registry_digest: string;
  provider_only: boolean;
  persistent_paths: string[];
  persistent_path_set_digest: string;
  report_digest: string;
}

const FIXED_ROOT_FILES = new Set([
  "helpers.ts",
  "index.ts",
  "instructions.md",
  "variables.ts",
]);
const TEMPLATE_NAME = /^[a-z0-9][a-z0-9._-]*\.md$/u;

async function statusIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function fixedCustomizationPaths(root: string, indexerId: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    const status = await lstat(absolute);
    if (status.isSymbolicLink()) {
      throw new TypeError(`Indexer customization persistence must not contain symlinks: ${indexerId}/${entry.name}`);
    }
    if (entry.name === "templates") {
      if (!status.isDirectory()) throw new TypeError("Indexer customization templates must be a directory");
      for (const template of await readdir(absolute, { withFileTypes: true })) {
        const templateStatus = await lstat(join(absolute, template.name));
        if (!templateStatus.isFile() || templateStatus.isSymbolicLink() || !TEMPLATE_NAME.test(template.name)) {
          throw new TypeError(`Indexer customization contains an unsupported template path: ${indexerId}/templates/${template.name}`);
        }
        paths.push(`src/indexer/${indexerId}/templates/${template.name}`);
      }
      continue;
    }
    if (!status.isFile() || !FIXED_ROOT_FILES.has(entry.name)) {
      throw new TypeError(`Indexer customization contains an unsupported persistent path: ${indexerId}/${entry.name}`);
    }
    paths.push(`src/indexer/${indexerId}/${entry.name}`);
  }
  if (paths.length === 0) {
    throw new TypeError(`declared Indexer customization is empty: ${indexerId}`);
  }
  return paths.sort(compareIndexerCanonicalText);
}

function reportPayload(
  value: Omit<IndexerWorkspacePersistenceReport, "report_digest">,
): Omit<IndexerWorkspacePersistenceReport, "report_digest"> {
  return value;
}

function hasLegacyCodeIndexerExtensions(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const context = (value as Record<string, unknown>).context;
  if (context === null || typeof context !== "object" || Array.isArray(context)) return false;
  const codeIndex = (context as Record<string, unknown>).codeIndex;
  if (codeIndex === null || typeof codeIndex !== "object" || Array.isArray(codeIndex)) return false;
  return Object.hasOwn(codeIndex, "extensions");
}

async function rejectLegacyPackageIndexerPersistence(workspaceRoot: string): Promise<void> {
  const packagePath = join(workspaceRoot, "package.json");
  const status = await statusIfPresent(packagePath);
  if (status === undefined) return;
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new TypeError("workspace package.json must be one real file");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(packagePath, "utf8")) as unknown;
  } catch {
    throw new TypeError("workspace package.json is invalid JSON");
  }
  if (hasLegacyCodeIndexerExtensions(value)) {
    throw new TypeError(
      "package.json context.codeIndex.extensions is legacy persistent authority; use src/indexers.yaml",
    );
  }
}

export async function auditIndexerWorkspacePersistence(input: {
  workspaceRoot: string;
  registry: IndexerRegistry;
}): Promise<IndexerWorkspacePersistenceReport> {
  if (!isAbsolute(input.workspaceRoot)) throw new TypeError("workspace root must be absolute");
  const realWorkspace = await realpath(input.workspaceRoot);
  await rejectLegacyPackageIndexerPersistence(input.workspaceRoot);
  const registryPath = join(input.workspaceRoot, "src", "indexers.yaml");
  const registryStatus = await statusIfPresent(registryPath);
  if (registryStatus === undefined || !registryStatus.isFile() || registryStatus.isSymbolicLink()) {
    throw new TypeError("Indexer registry persistence must be one real src/indexers.yaml file");
  }
  const realRegistryPath = await realpath(registryPath);
  const registryContainment = relative(realWorkspace, realRegistryPath);
  if (
    registryContainment === ".." ||
    registryContainment.startsWith(`..${sep}`) ||
    isAbsolute(registryContainment)
  ) {
    throw new TypeError("src/indexers.yaml escapes the workspace");
  }
  const persistedRegistry = parseIndexerRegistry(
    await readFile(realRegistryPath, "utf8"),
    "src/indexers.yaml",
  );
  if (indexerProtocolDigest(persistedRegistry) !== indexerProtocolDigest(input.registry)) {
    throw new TypeError("persisted src/indexers.yaml does not match the audited registry");
  }
  const declared = input.registry.indexers
    .filter((indexer) => indexer.customization !== undefined)
    .map((indexer) => indexer.id)
    .sort(compareIndexerCanonicalText);
  const customizationRoot = join(input.workspaceRoot, "src", "indexer");
  const rootStatus = await statusIfPresent(customizationRoot);
  if (declared.length === 0) {
    if (rootStatus !== undefined) {
      throw new TypeError("provider-only workspace must not persist src/indexer");
    }
  } else if (rootStatus === undefined || !rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new TypeError("declared Indexer customizations require one real src/indexer directory");
  }

  const persistentPaths = ["src/indexers.yaml"];
  if (rootStatus !== undefined) {
    const realCustomizationRoot = await realpath(customizationRoot);
    const containment = relative(realWorkspace, realCustomizationRoot);
    if (containment === ".." || containment.startsWith(`..${sep}`) || isAbsolute(containment)) {
      throw new TypeError("src/indexer directory escapes the workspace");
    }
    const entries = await readdir(customizationRoot, { withFileTypes: true });
    const actual = entries.map((entry) => entry.name).sort(compareIndexerCanonicalText);
    if (
      actual.length !== declared.length ||
      actual.some((name, index) => name !== declared[index])
    ) {
      throw new TypeError("src/indexer directory set must exactly match declared customizations");
    }
    for (const indexerId of declared) {
      const absolute = join(customizationRoot, indexerId);
      const status = await lstat(absolute);
      if (!status.isDirectory() || status.isSymbolicLink()) {
        throw new TypeError(`Indexer customization must be a real directory: ${indexerId}`);
      }
      persistentPaths.push(...await fixedCustomizationPaths(absolute, indexerId));
    }
  }
  persistentPaths.sort(compareIndexerCanonicalText);
  const base: Omit<IndexerWorkspacePersistenceReport, "report_digest"> = {
    protocol: "context.indexer.workspace-persistence-report/v1",
    registry_digest: indexerRegistryDigests(input.registry).registryDigest,
    provider_only: declared.length === 0,
    persistent_paths: persistentPaths,
    persistent_path_set_digest: indexerProtocolDigest({
      protocol: "context.indexer.workspace-persistent-path-set/v1",
      paths: persistentPaths,
    }),
  };
  return { ...base, report_digest: indexerProtocolDigest(reportPayload(base)) };
}
