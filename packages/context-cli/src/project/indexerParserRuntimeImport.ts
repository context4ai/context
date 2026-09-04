import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { pathToFileURL } from "node:url";
import {
  indexerProtocolDigest,
  validateIndexerParserImport,
  validateIndexerParserResolutionLock,
  type IndexerParserCoordinateMapping,
  type IndexerParserRequirement,
  type IndexerParserResolutionLock,
} from "@c4a/context";

interface PackageManifest {
  name?: unknown;
  version?: unknown;
}

export interface InstalledIndexerParserPackage {
  package: string;
  version: string;
  lock_integrity: string;
  resolved_digest: string;
}

const requireFromCli = createRequire(import.meta.url);

export interface IndexerParserImportReceipt {
  protocol: "context.indexer.parser-import-receipt/v1";
  capability: string;
  requirement_digest: string;
  mapping_digest: string;
  parser_lock_digest: string;
  package: string;
  export: string;
  version: string;
  resolved_entry_digest: string;
  resolved_content_digest: string;
  receipt_digest: string;
}

async function packageManifestForEntry(
  entryPath: string,
  expectedPackage: string,
): Promise<{ path: string; value: { name: string; version: string } }> {
  let directory = dirname(entryPath);
  const root = parse(directory).root;
  while (directory !== root) {
    const path = join(directory, "package.json");
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as PackageManifest;
      if (parsed.name === expectedPackage) {
        if (typeof parsed.version !== "string") {
          throw new TypeError(`installed parser ${expectedPackage} has no package version`);
        }
        return { path, value: { name: expectedPackage, version: parsed.version } };
      }
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        (error && typeof error === "object" && "code" in error && error.code !== "ENOENT")
      ) {
        throw error;
      }
    }
    directory = dirname(directory);
  }
  throw new TypeError(`cannot locate installed package manifest for ${expectedPackage}`);
}

async function resolveInstalledParserPackage(input: {
  package: string;
  version: string;
}): Promise<{
  entry_path: string;
  entry_content: Buffer;
  manifest: { name: string; version: string };
}> {
  let entryPath: string;
  try {
    entryPath = requireFromCli.resolve(input.package);
  } catch (error) {
    throw new TypeError(`locked parser package is not installed: ${input.package}`, {
      cause: error,
    });
  }
  const manifest = await packageManifestForEntry(entryPath, input.package);
  if (manifest.value.version !== input.version) {
    throw new TypeError(
      `installed parser ${manifest.value.name}@${manifest.value.version} does not match lock ${input.version}`,
    );
  }
  return {
    entry_path: entryPath,
    entry_content: await readFile(entryPath),
    manifest: manifest.value,
  };
}

export async function inspectInstalledIndexerParserPackage(input: {
  package: string;
  version: string;
}): Promise<InstalledIndexerParserPackage> {
  const installed = await resolveInstalledParserPackage(input);
  return {
    package: installed.manifest.name,
    version: installed.manifest.version,
    lock_integrity: `sha512-${createHash("sha512").update(installed.entry_content).digest("base64")}`,
    resolved_digest:
      `sha256:${createHash("sha256").update(installed.entry_content).digest("hex")}`,
  };
}

function receiptDigest(
  value: Omit<IndexerParserImportReceipt, "receipt_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function validateIndexerParserImportReceipt(
  value: IndexerParserImportReceipt,
): IndexerParserImportReceipt {
  if (value.protocol !== "context.indexer.parser-import-receipt/v1") {
    throw new TypeError("parser import receipt protocol is invalid");
  }
  const { receipt_digest: _digest, ...payload } = value;
  void _digest;
  if (receiptDigest(payload) !== value.receipt_digest) {
    throw new TypeError("parser import receipt digest is invalid");
  }
  return value;
}

export async function loadProjectIndexerParser(input: {
  requirement: IndexerParserRequirement;
  mapping: IndexerParserCoordinateMapping;
  lock: IndexerParserResolutionLock;
}): Promise<{
  adapter: (...args: unknown[]) => unknown;
  module: Record<string, unknown>;
  receipt: IndexerParserImportReceipt;
}> {
  const lock = validateIndexerParserResolutionLock({
    requirement: input.requirement,
    mapping: input.mapping,
    lock: input.lock,
  });
  validateIndexerParserImport({
    requirement: input.requirement,
    mapping: input.mapping,
    lock,
    parser_import: {
      capability: lock.capability,
      ...lock.actual_coordinate,
      parser_lock_digest: lock.lock_digest,
    },
  });
  const installed = await resolveInstalledParserPackage({
    package: lock.actual_coordinate.package,
    version: lock.actual_coordinate.version,
  });
  const resolvedEntryDigest =
    `sha256:${createHash("sha256").update(installed.entry_content).digest("hex")}`;
  const loaded = await import(pathToFileURL(installed.entry_path).href) as Record<string, unknown>;
  const adapter = loaded[lock.actual_coordinate.export];
  if (typeof adapter !== "function") {
    throw new TypeError(
      `installed parser ${lock.actual_coordinate.package} does not export ${lock.actual_coordinate.export}`,
    );
  }
  const payload: Omit<IndexerParserImportReceipt, "receipt_digest"> = {
    protocol: "context.indexer.parser-import-receipt/v1",
    capability: lock.capability,
    requirement_digest: lock.requirement_digest,
    mapping_digest: lock.mapping_digest,
    parser_lock_digest: lock.lock_digest,
    package: lock.actual_coordinate.package,
    export: lock.actual_coordinate.export,
    version: lock.actual_coordinate.version,
    resolved_entry_digest: resolvedEntryDigest,
    resolved_content_digest: lock.resolved_content_digest,
  };
  return {
    adapter: adapter as (...args: unknown[]) => unknown,
    module: loaded,
    receipt: { ...payload, receipt_digest: receiptDigest(payload) },
  };
}
