import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  indexerCliReleaseManifestSchema,
  resolvedProviderReceiptDigest,
  validateIndexerOperatorContract,
  validateIndexerProfileContract,
  validateResolvedProviderBundle,
  type ExpectedProviderResolution,
  type IndexerCliReleaseManifest,
  type IndexerOperatorContract,
  type IndexerProfileContract,
  type ResolvedProviderBundle,
} from "@c4a/context";
import { collectIndexerBundleFiles } from "./indexerDistributionBuild.js";
import {
  assertIndexerReleaseCapabilityReady,
  indexerBundleReleaseCapability,
  validateIndexerReleaseCapabilityManifest,
  type IndexerReleaseCapabilityManifest,
} from "./indexerReleaseCapabilities.js";

export interface CliBundledIndexerCatalogEntry {
  skill: string;
  version: string;
  source_type: "cli-bundled";
  distribution: {
    kind: "cli-bundled";
    locator: string;
  };
  integrity: string;
  manifest_digest: string;
}

export interface CliBundledIndexerCatalog {
  protocol: "context.indexer.cli-bundled-catalog/v1";
  package: "@c4a/context-cli";
  version: string;
  issuer: "context4ai/context";
  bundles: CliBundledIndexerCatalogEntry[];
}

function sameFiles(
  actual: readonly { path: string; digest: string }[],
  expected: readonly { path: string; digest: string }[],
): boolean {
  return actual.length === expected.length && actual.every((file, index) =>
    file.path === expected[index]?.path && file.digest === expected[index]?.digest
  );
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new TypeError(
      `bundled Indexer asset is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function defaultCliIndexerAssetsRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, "indexers"),
    resolve(moduleDir, "../../dist/indexers"),
  ];
  const found = candidates.find((candidate) => existsSync(join(candidate, "release-manifest.json")));
  if (found === undefined) {
    throw new TypeError("bundled Indexer release assets are unavailable; build @c4a/context-cli first");
  }
  return found;
}

export async function loadCliIndexerReleaseManifest(input: {
  assetsRoot?: string;
  expectedPackageVersion?: string;
} = {}): Promise<IndexerCliReleaseManifest> {
  const assetsRoot = input.assetsRoot ?? defaultCliIndexerAssetsRoot();
  const manifest = indexerCliReleaseManifestSchema.parse(
    await readJson(join(assetsRoot, "release-manifest.json")),
  );
  if (
    input.expectedPackageVersion !== undefined &&
    manifest.version !== input.expectedPackageVersion
  ) {
    throw new TypeError("bundled Indexer release manifest does not match the current CLI version");
  }
  return manifest;
}

export async function loadCliReleaseCapabilityManifest(input: {
  assetsRoot?: string;
  expectedPackageVersion?: string;
} = {}): Promise<IndexerReleaseCapabilityManifest> {
  const assetsRoot = input.assetsRoot ?? defaultCliIndexerAssetsRoot();
  return validateIndexerReleaseCapabilityManifest(
    await readJson(join(assetsRoot, "capability-manifest.json")),
    input.expectedPackageVersion,
  );
}

export async function loadCliIndexerBaseContracts(input: {
  assetsRoot?: string;
} = {}): Promise<{
  operators: IndexerOperatorContract;
  profiles: IndexerProfileContract;
}> {
  const assetsRoot = input.assetsRoot ?? defaultCliIndexerAssetsRoot();
  const operators = validateIndexerOperatorContract(
    await readJson(join(assetsRoot, "contracts", "operator-contract.json")),
  );
  const profiles = validateIndexerProfileContract(
    await readJson(join(assetsRoot, "contracts", "profile-contract.json")),
    operators,
  );
  return { operators, profiles };
}

export async function listCliBundledIndexers(input: {
  assetsRoot?: string;
  expectedPackageVersion?: string;
} = {}): Promise<CliBundledIndexerCatalog> {
  const manifest = await loadCliIndexerReleaseManifest(input);
  const capabilities = await loadCliReleaseCapabilityManifest({
    ...(input.assetsRoot === undefined ? {} : { assetsRoot: input.assetsRoot }),
    expectedPackageVersion: input.expectedPackageVersion ?? manifest.version,
  });
  return {
    protocol: "context.indexer.cli-bundled-catalog/v1",
    package: manifest.package,
    version: manifest.version,
    issuer: manifest.issuer,
    bundles: manifest.bundles.filter((bundle) => {
      const feature = indexerBundleReleaseCapability(bundle.skill);
      return capabilities.capabilities.find((item) => item.id === feature)?.state === "ready";
    }).map((bundle) => ({
      skill: bundle.skill,
      version: bundle.version,
      source_type: "cli-bundled",
      distribution: bundle.distribution,
      integrity: bundle.integrity,
      manifest_digest: bundle.manifest_digest,
    })),
  };
}

async function verifyReleaseBundle(input: {
  assetsRoot: string;
  bundle: IndexerCliReleaseManifest["bundles"][number];
}): Promise<string> {
  const bundleRoot = join(input.assetsRoot, "bundles", input.bundle.skill);
  if (!existsSync(join(bundleRoot, "context-indexer.yaml"))) {
    throw new TypeError(
      `cli-bundled Provider Bundle is unavailable for reindex: ${input.bundle.skill}@${input.bundle.version}`,
    );
  }
  const actual = await collectIndexerBundleFiles(bundleRoot);
  if (!sameFiles(actual, input.bundle.files)) {
    throw new TypeError(`cli-bundled Provider ${input.bundle.skill} failed its release file ledger`);
  }
  return bundleRoot;
}

async function materializeTransport(input: {
  bundleRoot: string;
  files: readonly { path: string; digest: string }[];
  transportRoot: string;
}): Promise<string> {
  await mkdir(input.transportRoot, { recursive: true });
  const target = await mkdtemp(join(input.transportRoot, "cli-bundled-"));
  for (const file of input.files) {
    const destination = join(target, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(input.bundleRoot, file.path), destination);
  }
  const copied = await collectIndexerBundleFiles(target);
  if (!sameFiles(copied, input.files)) {
    throw new TypeError("cli-bundled Provider transport copy failed integrity validation");
  }
  return target;
}

export async function resolveCliBundledIndexerProvider(input: {
  assetsRoot?: string;
  expectedPackageVersion: string;
  expected: ExpectedProviderResolution;
  transportRoot: string;
  now?: Date;
  ttlMs?: number;
}): Promise<ResolvedProviderBundle> {
  if (input.expected.distribution.kind !== "cli-bundled") {
    throw new TypeError("CLI first-party resolver only accepts cli-bundled distributions");
  }
  const assetsRoot = input.assetsRoot ?? defaultCliIndexerAssetsRoot();
  const manifest = await loadCliIndexerReleaseManifest({
    assetsRoot,
    expectedPackageVersion: input.expectedPackageVersion,
  });
  const capabilities = await loadCliReleaseCapabilityManifest({
    assetsRoot,
    expectedPackageVersion: input.expectedPackageVersion,
  });
  assertIndexerReleaseCapabilityReady(
    capabilities,
    indexerBundleReleaseCapability(input.expected.skill),
  );
  const selected = manifest.bundles.find((bundle) =>
    bundle.skill === input.expected.skill &&
    bundle.version === input.expected.version &&
    bundle.distribution.locator === input.expected.distribution.locator
  );
  if (selected === undefined || selected.integrity !== input.expected.integrity) {
    throw new TypeError("requested cli-bundled Provider is not present in this exact CLI release");
  }
  const bundleRoot = await verifyReleaseBundle({ assetsRoot, bundle: selected });
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? 5 * 60 * 1000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 60 * 60 * 1000) {
    throw new TypeError("cli-bundled transport TTL must be between 1 ms and 1 hour");
  }
  const transportPath = await materializeTransport({
    bundleRoot,
    files: selected.files,
    transportRoot: input.transportRoot,
  });
  const envelope: ResolvedProviderBundle = {
    protocol: "context.indexer.resolved-provider-bundle/v1",
    request: {
      indexer_id: input.expected.indexerId,
      provider_id: input.expected.providerId,
      skill: selected.skill,
      version: selected.version,
      distribution: selected.distribution,
    },
    resolved: {
      integrity: selected.integrity,
      manifest_digest: selected.manifest_digest,
      issuer: manifest.issuer,
      trust: "first-party",
    },
    transport: {
      kind: "directory",
      path: transportPath,
      expires_at: new Date(now.getTime() + ttlMs).toISOString(),
    },
    files: selected.files,
    receipt: {
      resolver: `context-cli/${manifest.version}`,
      resolved_at: now.toISOString(),
      authority_ref: `cli-release-manifest:indexer-bundles@${manifest.version}`,
      receipt_digest: selected.integrity,
    },
  };
  envelope.receipt.receipt_digest = resolvedProviderReceiptDigest(envelope);
  return validateResolvedProviderBundle(envelope, input.expected, now);
}
