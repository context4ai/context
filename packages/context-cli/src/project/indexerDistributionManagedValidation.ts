import { access } from "node:fs/promises";
import { join } from "node:path";
import type { IndexerOperatorContract, IndexerProfileContract, IndexerProviderManifest } from "@c4a/context";
import { validateBundledIndexerAuthoringFixtures } from "./indexerDistributionFixtureValidation.js";
import { validateBundledIndexerProfileTemplates } from "./indexerDistributionProfileResources.js";

/** Validate shipped source-specific Providers without treating the catalog as
 * a whitelist for business distributions. Extensions reuse base contracts. */
export async function validateManagedIndexerDistribution(input: {
  source: string; manifest: IndexerProviderManifest;
  profileContract: IndexerProfileContract; operatorContract: IndexerOperatorContract;
}): Promise<void> {
  if (!["context-note-indexer", "context-sessions-indexer"].includes(input.manifest.id)) return;
  const extensions = new Set(input.manifest.composition?.extensions.map((item) => item.profile) ?? []);
  const profiles = input.manifest.provides.profiles.filter((id) => !extensions.has(id));
  await validateBundledIndexerAuthoringFixtures({ ...input, bundleId: input.manifest.id,
    fixtureFile: "profiles.json", coverage: "all-profiles", expectedProfiles: profiles });
  validateBundledIndexerProfileTemplates({ bundleId: input.manifest.id, expectedProfiles: profiles, manifest: input.manifest });
  const paths = new Set([
    ...(input.manifest.provider.instructions ?? []).map((item) => item.path),
    ...(input.manifest.provider.templates ?? []).map((item) => item.path),
    ...(input.manifest.customization?.guide ? [input.manifest.customization.guide] : []),
  ]);
  await Promise.all([...paths].map((path) => access(join(input.source, path))));
}
