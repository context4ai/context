import { join } from "node:path";
import {
  buildIndexerPrimaryExecutionProjection,
  buildIndexerPrimaryRegistryProjection,
  indexerProtocolDigest,
  loadIndexerProviderManifest,
  resolveIndexerPartitionStrategies,
  type IndexerRegistry,
} from "@c4a/context";
import {
  defaultCliIndexerAssetsRoot,
  listCliBundledIndexers,
  loadCliIndexerBaseContracts,
  loadCliIndexerReleaseManifest,
} from "./indexerCliBundledProvider.js";
import { collectIndexerBundleFiles } from "./indexerDistributionBuild.js";

function sameFiles(
  actual: readonly { path: string; digest: string }[],
  expected: readonly { path: string; digest: string }[],
): boolean {
  return actual.length === expected.length && actual.every((file, index) =>
    file.path === expected[index]?.path && file.digest === expected[index]?.digest
  );
}

export async function resolveCurrentProjectIndexerPrimaryAuthority(input: {
  registry: IndexerRegistry;
  indexer_id: string;
}) {
  const indexer = input.registry.indexers.find((candidate) =>
    candidate.id === input.indexer_id
  );
  if (indexer === undefined) throw new TypeError(`unknown Indexer ${input.indexer_id}`);
  if (indexer.customization !== undefined) {
    throw new TypeError(
      `Indexer ${indexer.id} customization must be resolved before main workset construction`,
    );
  }
  if (
    (indexer.profile.additional?.length ?? 0) > 0
  ) {
    throw new TypeError(
      `Indexer ${indexer.id} extension authority must be resolved before main workset construction`,
    );
  }
  const provider = indexer.providers.find((candidate) =>
    candidate.id === indexer.profile.primary.provider && candidate.role === "primary"
  );
  if (provider === undefined) {
    throw new TypeError(`Indexer ${indexer.id} has no primary profile Provider`);
  }
  if (provider.distribution.kind !== "cli-bundled") {
    throw new TypeError(
      `Indexer ${indexer.id} primary Provider must be resolved by its declared distribution`,
    );
  }

  const assetsRoot = defaultCliIndexerAssetsRoot();
  const [catalog, release, contracts] = await Promise.all([
    listCliBundledIndexers({ assetsRoot }),
    loadCliIndexerReleaseManifest({ assetsRoot }),
    loadCliIndexerBaseContracts({ assetsRoot }),
  ]);
  const selected = catalog.bundles.find((candidate) =>
    candidate.skill === provider.skill &&
    candidate.version === provider.version &&
    candidate.integrity === provider.integrity &&
    candidate.distribution.locator === provider.distribution.locator
  );
  const releaseBundles = release.bundles.filter((candidate) =>
    candidate.skill === provider.skill &&
    candidate.version === provider.version &&
    candidate.integrity === provider.integrity &&
    candidate.distribution.kind === provider.distribution.kind &&
    candidate.distribution.locator === provider.distribution.locator
  );
  const releaseBundle = releaseBundles[0];
  if (
    selected === undefined ||
    releaseBundle === undefined ||
    releaseBundles.length !== 1
  ) {
    throw new TypeError(
      `Indexer ${indexer.id} primary Provider is absent from this exact CLI release`,
    );
  }
  const bundleRoot = join(assetsRoot, "bundles", provider.skill);
  const files = await collectIndexerBundleFiles(bundleRoot);
  if (!sameFiles(files, releaseBundle.files)) {
    throw new TypeError(`Indexer ${indexer.id} primary Provider Bundle changed after release`);
  }
  const manifest = await loadIndexerProviderManifest(bundleRoot);
  if (
    manifest.id !== provider.skill ||
    manifest.version !== provider.version ||
    !manifest.provides.profiles.includes(indexer.profile.primary.id)
  ) {
    throw new TypeError(`Indexer ${indexer.id} primary Provider manifest is incompatible`);
  }
  const profile = contracts.profiles.profiles.find((candidate) =>
    candidate.id === indexer.profile.primary.id
  );
  if (profile === undefined) {
    throw new TypeError(`Indexer ${indexer.id} primary profile is absent from the CLI contract`);
  }
  const fileDigest = new Map(files.map((file) => [file.path, file.digest]));
  const layerRef = `provider:${provider.id}#layer:${provider.role}`;
  const instructions = (manifest.provider.instructions ?? [])
    .filter((instruction) => instruction.profiles.includes(profile.id))
    .map((instruction) => ({
      kind: "instructions" as const,
      ref: `bundle:${manifest.id}/${instruction.path}`,
      digest: fileDigest.get(instruction.path),
    }));
  const templates = (manifest.provider.templates ?? [])
    .filter((template) => template.profile === profile.id)
    .map((template) => ({
      kind: "template" as const,
      ref: `bundle:${manifest.id}/${template.path}`,
      digest: fileDigest.get(template.path),
    }));
  for (const resource of [...instructions, ...templates]) {
    if (resource.digest === undefined) {
      throw new TypeError(`Indexer ${indexer.id} primary Provider resource is missing`);
    }
  }
  const programPath = manifest.provider.program?.execution.entry;
  const programDigest = programPath === undefined ? null : fileDigest.get(programPath);
  if (programPath !== undefined && programDigest === undefined) {
    throw new TypeError(`Indexer ${indexer.id} primary Provider program is missing`);
  }
  const primaryRegistry = buildIndexerPrimaryRegistryProjection({
    registry: input.registry,
    indexer_id: indexer.id,
  });
  const primaryExecution = buildIndexerPrimaryExecutionProjection({
    indexer_id: indexer.id,
    primary_registry_projection_digest: primaryRegistry.projection_digest,
    program_digest: programDigest ?? null,
    instructions_digest: indexerProtocolDigest(instructions),
    template_set_digest: indexerProtocolDigest(templates),
    config_digest: indexerProtocolDigest(provider.config ?? {}),
    cli_contract_digest: contracts.operators.contract_digest,
    profile_contract_digest: contracts.profiles.contract_digest,
    resources: [...instructions, ...templates].map((resource) => ({
      layer_ref: layerRef,
      phase: "primary" as const,
      kind: resource.kind,
      ref: resource.ref,
      digest: resource.digest!,
    })),
  });
  const partitionStrategies = resolveIndexerPartitionStrategies({
    indexer_id: indexer.id,
    indexer_fingerprint: primaryExecution.primary_execution_fingerprint,
    registry_projection_digest: primaryRegistry.projection_digest,
    selected_profile_ids: [profile.id],
    provider: {
      layer_ref: layerRef,
      id: manifest.id,
      version: manifest.version,
      integrity: provider.integrity,
      bundle_digest: provider.integrity,
      manifest_digest: releaseBundle.manifest_digest,
      manifest,
    },
    cli_release_digest: indexerProtocolDigest(release),
    cli_builtins: [],
  });
  return {
    indexer,
    provider,
    manifest,
    profile,
    operator_contract: contracts.operators,
    profile_contract: contracts.profiles,
    primary_registry: primaryRegistry,
    primary_execution: primaryExecution,
    partition_strategies: partitionStrategies,
  };
}
