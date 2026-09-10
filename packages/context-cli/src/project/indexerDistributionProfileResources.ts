import type { IndexerProviderManifest } from "@c4a/context";

export function validateBundledIndexerProfileTemplates(input: {
  bundleId: string;
  expectedProfiles: readonly string[];
  manifest: IndexerProviderManifest;
}): void {
  const templates = input.manifest.provider.templates ?? [];
  if (new Set(templates.map((template) => `${template.profile}/${template.id}`)).size !== templates.length) {
    throw new TypeError(
      `${input.bundleId} contains duplicate profile/template identities`,
    );
  }
  if (input.bundleId === "context-code-indexer") for (const template of templates) {
    if (template.kind !== "page-program" && template.kind !== "procedure" && (template.id !== template.profile ||
        template.path !== `templates/${template.profile}.md`)) {
      throw new TypeError(`${input.bundleId} profile ${template.profile} must use its own canonical template`);
    }
  }
  input.expectedProfiles.forEach((profile) => {
    if (!templates.some((template) => template.profile === profile)) {
      throw new TypeError(
        `${input.bundleId} profile ${profile} must provide at least one template`,
      );
    }
  });
}
