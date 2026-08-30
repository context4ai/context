import type { IndexerProviderManifest } from "./indexerProvider.js";
import {
  validateIndexerOperatorContract,
  validateIndexerProfileContract,
} from "./indexerProfileContract.js";

type ValidatedIndexerProfile = ReturnType<
  typeof validateIndexerProfileContract
>["profiles"][number];

function selectedBaseProfileIds(input: {
  manifest: IndexerProviderManifest;
  selectedProfiles: readonly string[];
  registeredProfiles: ReadonlySet<string>;
}): Set<string> {
  const selected = new Set<string>();
  for (const profileId of input.selectedProfiles) {
    const isProvidedProfile = input.manifest.provides.profiles.includes(profileId);
    const isComposerTarget = (input.manifest.provides.composers ?? []).some((composer) =>
      composer.supported_profiles.includes(profileId)
    );
    if (!isProvidedProfile && !isComposerTarget) {
      throw new TypeError(`Provider does not provide selected profile ${profileId}`);
    }
    if (input.registeredProfiles.has(profileId)) {
      selected.add(profileId);
      continue;
    }
    const extension = input.manifest.composition?.extensions.find((item) =>
      item.profile === profileId
    );
    if (extension === undefined || !input.registeredProfiles.has(extension.extends)) {
      throw new TypeError(
        `Provider profile ${profileId} has no target CLI base profile contract`,
      );
    }
    selected.add(extension.extends);
  }
  if (selected.size === 0) {
    throw new TypeError("Provider contract validation requires a selected profile");
  }
  return selected;
}

function validateComposerContractReferences(input: {
  manifest: IndexerProviderManifest;
  profilesById: ReadonlyMap<string, ValidatedIndexerProfile>;
}): void {
  for (const composer of input.manifest.provides.composers ?? []) {
    if (composer.contract === undefined) continue;
    for (const supportedProfile of composer.supported_profiles) {
      const baseProfileId = input.profilesById.has(supportedProfile)
        ? supportedProfile
        : input.manifest.composition?.extensions.find((extension) =>
          extension.profile === supportedProfile
        )?.extends;
      const profile = baseProfileId === undefined
        ? undefined
        : input.profilesById.get(baseProfileId);
      if (profile === undefined) {
        throw new TypeError(
          `Provider composer ${composer.id} has no target CLI base profile contract`,
        );
      }
      const variant = profile.artifact_policy_variants.find((item) =>
        item.id === composer.contract!.derived_artifact_policy.artifact_policy_variant
      );
      if (variant === undefined) {
        throw new TypeError(
          `Provider composer ${composer.id} references an unregistered Artifact policy variant for ${supportedProfile}`,
        );
      }
      const allowedArtifactKinds = new Set([
        ...variant.artifact_kinds.required,
        ...variant.artifact_kinds.discretionary,
      ]);
      for (const artifactKind of [
        ...composer.contract.primary_requirements.artifact_kinds,
        ...composer.contract.derived_artifact_policy.artifact_kinds,
      ]) {
        if (!allowedArtifactKinds.has(artifactKind)) {
          throw new TypeError(
            `Provider composer ${composer.id} references unregistered Artifact kind ${artifactKind} for ${supportedProfile}`,
          );
        }
      }
    }
  }
}

/**
 * Validates the IDs a Provider advertises against the selected CLI-owned
 * profile contracts. Providers may describe support and repair guidance, but
 * they cannot introduce Artifact kinds, policy variants, metrics, or numeric
 * thresholds.
 */
export function validateIndexerProviderContractReferences(input: {
  manifest: IndexerProviderManifest;
  selected_profiles: readonly string[];
  profile_contract: unknown;
  operator_contract: unknown;
}): void {
  const hasContractReferences = (input.manifest.quality_guidance?.metric_ids.length ?? 0) > 0 ||
    (input.manifest.provides.logical_units ?? []).some((logicalUnit) =>
      logicalUnit.artifacts !== undefined
    ) || (input.manifest.provides.composers ?? []).some((composer) =>
      composer.contract !== undefined
    );
  if (!hasContractReferences) return;
  const operators = validateIndexerOperatorContract(input.operator_contract);
  const contract = validateIndexerProfileContract(input.profile_contract, operators);
  const profilesById = new Map(contract.profiles.map((profile) => [profile.id, profile]));
  const targetProfileIds = selectedBaseProfileIds({
    manifest: input.manifest,
    selectedProfiles: input.selected_profiles,
    registeredProfiles: new Set(profilesById.keys()),
  });
  const targetProfiles = [...targetProfileIds].map((profileId) => profilesById.get(profileId)!);
  const metricIds = new Set(targetProfiles.flatMap((profile) =>
    profile.metrics.map((metric) => metric.id)
  ));
  const variants = new Map(targetProfiles.flatMap((profile) =>
    profile.artifact_policy_variants.map((variant) => [variant.id, variant] as const)
  ));
  const artifactKinds = new Set([...variants.values()].flatMap((variant) => [
    ...variant.artifact_kinds.required,
    ...variant.artifact_kinds.discretionary,
  ]));
  const sourceRoles = new Set(targetProfiles.flatMap((profile) =>
    profile.layout_mappings.flatMap((mapping) => mapping.source_roles)
  ));

  for (const sourceRole of input.manifest.provides.source_roles ?? []) {
    if (!sourceRoles.has(sourceRole)) {
      throw new TypeError(`Provider references unregistered layout source role ${sourceRole}`);
    }
  }
  for (const metricId of input.manifest.quality_guidance?.metric_ids ?? []) {
    if (!metricIds.has(metricId)) {
      throw new TypeError(`Provider quality guidance references unregistered metric ${metricId}`);
    }
  }
  for (const logicalUnit of input.manifest.provides.logical_units ?? []) {
    for (const variantId of logicalUnit.artifacts?.supported_policy_variants ?? []) {
      if (!variants.has(variantId)) {
        throw new TypeError(
          `Provider logical unit ${logicalUnit.id} references unregistered Artifact policy variant ${variantId}`,
        );
      }
    }
    for (const artifactKind of logicalUnit.artifacts?.recommended ?? []) {
      if (!artifactKinds.has(artifactKind)) {
        throw new TypeError(
          `Provider logical unit ${logicalUnit.id} references unregistered Artifact kind ${artifactKind}`,
        );
      }
    }
  }
  validateComposerContractReferences({ manifest: input.manifest, profilesById });
}
