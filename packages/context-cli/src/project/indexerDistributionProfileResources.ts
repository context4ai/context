import type { IndexerProviderManifest } from "@c4a/context";

export function validateBundledIndexerProfileTemplates(input: {
  bundleId: string;
  expectedProfiles: readonly string[];
  manifest: IndexerProviderManifest;
}): void {
  const templates = input.manifest.provider.templates ?? [];
  if (templates.length !== input.expectedProfiles.length) {
    throw new TypeError(
      `${input.bundleId} must provide exactly one template for every profile`,
    );
  }
  input.expectedProfiles.forEach((profile, index) => {
    const template = templates[index];
    if (
      template?.id !== profile
      || template.profile !== profile
      || template.path !== `templates/${profile}.md`
    ) {
      throw new TypeError(
        `${input.bundleId} profile ${profile} must use its own canonical template`,
      );
    }
  });
}
