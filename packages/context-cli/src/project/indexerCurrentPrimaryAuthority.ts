import { join } from "node:path";
import {
  buildIndexerPrimaryExecutionProjection,
  buildIndexerPrimaryRegistryProjection,
  indexerProtocolDigest,
  loadIndexerProviderManifest,
  resolveIndexerPartitionStrategies,
  type IndexerProviderCompositionPlan,
  type IndexerProviderManifest,
  type IndexerRegistry,
  type IndexerRegistryEntry,
  type ResolvedProviderBundle,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  defaultCliIndexerAssetsRoot,
  listCliBundledIndexers,
  loadCliIndexerBaseContracts,
  loadCliIndexerReleaseManifest,
} from "./indexerCliBundledProvider.js";
import type { IndexerCustomizationView } from "./indexerCustomization.js";
import { loadCurrentIndexerProviderSelection } from
  "./indexerCurrentProviderSelection.js";
import { collectIndexerBundleFiles } from "./indexerDistributionBuild.js";
import type { StagedIndexerProviderBundle } from "./indexerProviderStage.js";

function sameFiles(
  actual: readonly { path: string; digest: string }[],
  expected: readonly { path: string; digest: string }[],
): boolean {
  return actual.length === expected.length && actual.every((file, index) =>
    file.path === expected[index]?.path && file.digest === expected[index]?.digest
  );
}

export interface CurrentIndexerProviderLayerAuthority {
  layer: IndexerRegistryEntry["providers"][number];
  manifest: IndexerProviderManifest;
  manifest_digest: string;
  bundle_root: string;
  bundle_files: Array<{ path: string; digest: string }>;
  bundle?: ResolvedProviderBundle | undefined;
  staged?: StagedIndexerProviderBundle | undefined;
}

function bundledProviderIdentity(input: {
  skill: string;
  version: string;
  integrity: string;
  distribution: { kind: string; locator: string };
}): string {
  return `${input.skill}@${input.version} (integrity ${input.integrity}; ${input.distribution.kind} ${input.distribution.locator})`;
}

async function resolveBundledPrimary(input: {
  indexer: IndexerRegistryEntry;
  provider: IndexerRegistryEntry["providers"][number];
}) {
  const assetsRoot = defaultCliIndexerAssetsRoot();
  const [catalog, release, contracts] = await Promise.all([
    listCliBundledIndexers({ assetsRoot }),
    loadCliIndexerReleaseManifest({ assetsRoot }),
    loadCliIndexerBaseContracts({ assetsRoot }),
  ]);
  const selected = catalog.bundles.find((candidate) =>
    candidate.skill === input.provider.skill &&
    candidate.version === input.provider.version &&
    candidate.integrity === input.provider.integrity &&
    candidate.distribution.locator === input.provider.distribution.locator
  );
  const releaseBundles = release.bundles.filter((candidate) =>
    candidate.skill === input.provider.skill &&
    candidate.version === input.provider.version &&
    candidate.integrity === input.provider.integrity &&
    candidate.distribution.kind === input.provider.distribution.kind &&
    candidate.distribution.locator === input.provider.distribution.locator
  );
  const releaseBundle = releaseBundles[0];
  if (selected === undefined || releaseBundle === undefined || releaseBundles.length !== 1) {
    const available = catalog.bundles
      .filter((candidate) => candidate.skill === input.provider.skill)
      .map(bundledProviderIdentity);
    const reason = selected === undefined
      ? "the bundle catalog has no exact identity match"
      : `the release manifest has ${releaseBundles.length} exact identity matches`;
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `Indexer ${input.indexer.id} requires exact primary Provider ${bundledProviderIdentity(input.provider)}, ` +
        `but the current CLI provides ${available.length === 0 ? `no ${input.provider.skill} bundle` : available.join(", ")}; ${reason}`,
      {
        category: ErrorCategory.ProviderIdentityMismatch,
        indexer_id: input.indexer.id,
        required_provider: input.provider,
        available_providers: catalog.bundles.filter((candidate) =>
          candidate.skill === input.provider.skill
        ),
        next: "Use the exact CLI release pinned by the current registry, or start a new lifecycle after updating the registry through Provider selection.",
      },
    );
  }
  const bundleRoot = join(assetsRoot, "bundles", input.provider.skill);
  const files = await collectIndexerBundleFiles(bundleRoot);
  if (!sameFiles(files, releaseBundle.files)) {
    throw new TypeError(`Indexer ${input.indexer.id} primary Provider Bundle changed after release`);
  }
  const manifest = await loadIndexerProviderManifest(bundleRoot);
  return {
    layers: [{
      layer: input.provider,
      manifest,
      manifest_digest: releaseBundle.manifest_digest,
      bundle_root: bundleRoot,
      bundle_files: files,
      bundle: undefined,
      staged: undefined,
    }] satisfies CurrentIndexerProviderLayerAuthority[],
    operatorContract: contracts.operators,
    profileContract: contracts.profiles,
    compositionPlan: undefined as IndexerProviderCompositionPlan | undefined,
    customization: undefined as IndexerCustomizationView | undefined,
    providerSetDigest: indexerProtocolDigest(release),
  };
}

async function resolveSelectedLayers(input: {
  projectRoot: string;
  registry: IndexerRegistry;
  indexer: IndexerRegistryEntry;
}) {
  const state = await loadCurrentIndexerProviderSelection({
    projectRoot: input.projectRoot,
    registry: input.registry,
  });
  const resolved = state.resolved.filter((item) => item.indexer_id === input.indexer.id);
  if (resolved.length !== input.indexer.providers.length) {
    throw new TypeError(`Indexer ${input.indexer.id} Provider selection is incomplete`);
  }
  const layers = await Promise.all(input.indexer.providers.map(async (layer) => {
    const selected = resolved.find((item) => item.provider_id === layer.id);
    if (selected === undefined) {
      throw new TypeError(`Indexer ${input.indexer.id} Provider layer ${layer.id} is unavailable`);
    }
    return {
      layer,
      manifest: await loadIndexerProviderManifest(selected.staged.stage_path),
      manifest_digest: selected.bundle.resolved.manifest_digest,
      bundle_root: selected.staged.stage_path,
      bundle_files: selected.staged.files,
      bundle: selected.bundle,
      staged: selected.staged,
    } satisfies CurrentIndexerProviderLayerAuthority;
  }));
  const compositionPlan = state.final_report.composition_plans.find((item) =>
    item.indexer_id === input.indexer.id
  );
  if (compositionPlan === undefined) {
    throw new TypeError(`Indexer ${input.indexer.id} composition plan is unavailable`);
  }
  return {
    layers,
    operatorContract: state.operator_contract,
    profileContract: state.profile_contract,
    compositionPlan,
    customization: state.customizations.find((item) => item.indexer_id === input.indexer.id),
    providerSetDigest: indexerProtocolDigest({
      protocol: "context.indexer.selected-provider-set/v1",
      providers: resolved.map((item) => ({
        provider_id: item.provider_id,
        integrity: item.bundle.resolved.integrity,
        manifest_digest: item.bundle.resolved.manifest_digest,
        staged_receipt_digest: item.staged.receipt_digest,
      })),
    }),
  };
}

export async function resolveCurrentProjectIndexerPrimaryAuthority(input: {
  projectRoot?: string;
  registry: IndexerRegistry;
  indexer_id: string;
}) {
  const indexer = input.registry.indexers.find((candidate) => candidate.id === input.indexer_id);
  if (indexer === undefined) throw new TypeError(`unknown Indexer ${input.indexer_id}`);
  const provider = indexer.providers.find((candidate) =>
    candidate.id === indexer.profile.primary.provider && candidate.role === "primary"
  );
  if (provider === undefined) throw new TypeError(`Indexer ${indexer.id} has no primary Provider`);

  const requiresSelection = indexer.providers.length > 1 ||
    indexer.customization !== undefined ||
    provider.distribution.kind !== "cli-bundled";
  if (requiresSelection && input.projectRoot === undefined) {
    throw new TypeError(`Indexer ${indexer.id} requires its applied Provider selection`);
  }
  const selected = requiresSelection
    ? await resolveSelectedLayers({
        projectRoot: input.projectRoot!,
        registry: input.registry,
        indexer,
      })
    : await resolveBundledPrimary({ indexer, provider });
  const primaryLayer = selected.layers.find((item) => item.layer.id === provider.id);
  if (primaryLayer === undefined) {
    throw new TypeError(`Indexer ${indexer.id} primary Provider layer is unavailable`);
  }
  if (
    primaryLayer.manifest.id !== provider.skill ||
    primaryLayer.manifest.version !== provider.version ||
    !primaryLayer.manifest.provides.profiles.includes(indexer.profile.primary.id)
  ) {
    throw new TypeError(`Indexer ${indexer.id} primary Provider manifest is incompatible`);
  }
  const profile = selected.profileContract.profiles.find((candidate) =>
    candidate.id === indexer.profile.primary.id
  );
  if (profile === undefined) {
    throw new TypeError(`Indexer ${indexer.id} primary profile is absent from the contract`);
  }

  const activeBindings = [indexer.profile.primary, ...(indexer.profile.additional ?? [])];
  const resources = selected.layers.flatMap((layerAuthority) => {
    const activeProfiles = activeBindings
      .filter((binding) => binding.provider === layerAuthority.layer.id)
      .map((binding) => binding.id);
    const fileDigest = new Map(layerAuthority.bundle_files.map((file) => [file.path, file.digest]));
    const layerRef = `provider:${layerAuthority.layer.id}#layer:${layerAuthority.layer.role}`;
    const phase = layerAuthority.layer.role === "extension" ? "pre-authority" as const : "primary" as const;
    const declared = [
      ...(layerAuthority.manifest.provider.instructions ?? [])
        .filter((item) => item.profiles.some((id) => activeProfiles.includes(id)))
        .map((item) => ({ kind: "instructions", path: item.path })),
      ...(layerAuthority.manifest.provider.templates ?? [])
        .filter((item) => activeProfiles.includes(item.profile))
        .map((item) => ({ kind: "template", path: item.path })),
    ];
    return declared.map((resource) => {
      const digest = fileDigest.get(resource.path);
      if (digest === undefined) {
        throw new TypeError(`Indexer ${indexer.id} Provider resource ${resource.path} is missing`);
      }
      return {
        layer_ref: layerRef,
        phase,
        kind: resource.kind,
        ref: `bundle:${layerAuthority.manifest.id}/${resource.path}`,
        digest,
      };
    });
  });
  const primaryFiles = new Map(primaryLayer.bundle_files.map((file) => [file.path, file.digest]));
  const programPath = primaryLayer.manifest.provider.program?.execution.entry;
  const programDigest = programPath === undefined ? null : primaryFiles.get(programPath);
  if (programPath !== undefined && programDigest === undefined) {
    throw new TypeError(`Indexer ${indexer.id} primary Provider program is missing`);
  }
  const primaryRegistry = buildIndexerPrimaryRegistryProjection({
    registry: input.registry,
    indexer_id: indexer.id,
    pre_authority_provider_ids: selected.layers
      .filter((item) => item.layer.role === "extension")
      .map((item) => item.layer.id),
  });
  const primaryExecution = buildIndexerPrimaryExecutionProjection({
    indexer_id: indexer.id,
    primary_registry_projection_digest: primaryRegistry.projection_digest,
    program_digest: programDigest ?? null,
    instructions_digest: indexerProtocolDigest(resources.filter((item) => item.kind === "instructions")),
    template_set_digest: indexerProtocolDigest(resources.filter((item) => item.kind === "template")),
    config_digest: indexerProtocolDigest(indexer.providers.map((item) => ({
      id: item.id,
      config: item.config ?? {},
    }))),
    cli_contract_digest: selected.operatorContract.contract_digest,
    profile_contract_digest: selected.profileContract.contract_digest,
    resources,
  });
  const primaryProfileIds = activeBindings
    .filter((binding) => binding.provider === provider.id)
    .map((binding) => binding.id);
  const partitionStrategies = resolveIndexerPartitionStrategies({
    indexer_id: indexer.id,
    indexer_fingerprint: primaryExecution.primary_execution_fingerprint,
    registry_projection_digest: primaryRegistry.projection_digest,
    selected_profile_ids: primaryProfileIds,
    provider: {
      layer_ref: `provider:${provider.id}#layer:${provider.role}`,
      id: primaryLayer.manifest.id,
      version: primaryLayer.manifest.version,
      integrity: provider.integrity,
      bundle_digest: provider.integrity,
      manifest_digest: primaryLayer.manifest_digest,
      manifest: primaryLayer.manifest,
    },
    cli_release_digest: selected.providerSetDigest,
    cli_builtins: [],
  });
  return {
    indexer,
    provider,
    manifest: primaryLayer.manifest,
    profile,
    operator_contract: selected.operatorContract,
    profile_contract: selected.profileContract,
    primary_registry: primaryRegistry,
    primary_execution: primaryExecution,
    partition_strategies: partitionStrategies,
    bundle_root: primaryLayer.bundle_root,
    bundle_files: primaryLayer.bundle_files,
    release_bundle: { manifest_digest: primaryLayer.manifest_digest },
    layers: selected.layers,
    composition_plan: selected.compositionPlan,
    customization: selected.customization,
  };
}
