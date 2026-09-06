import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseIndexerProviderManifest } from "@c4a/context";
import {
  defaultCliIndexerAssetsRoot,
  type CliBundledIndexerCatalog,
} from "./indexerCliBundledProvider.js";

/** Selection guidance is read from the same release as the portable identity.
 * Keep it on the current Action input, never in the persistent registry.
 */
export async function projectIndexerSelectionCatalog(
  catalog: CliBundledIndexerCatalog,
  assetsRoot = defaultCliIndexerAssetsRoot(),
) {
  return Promise.all(catalog.bundles.map(async (bundle) => {
    const root = join(assetsRoot, "bundles", bundle.skill);
    const manifestPath = join(root, "context-indexer.yaml");
    const content = await readFile(manifestPath, "utf8");
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (digest !== bundle.manifest_digest) {
      throw new TypeError(`bundled Provider selection manifest changed: ${bundle.skill}`);
    }
    const manifest = parseIndexerProviderManifest(content, manifestPath);
    if (manifest.id !== bundle.skill || manifest.version !== bundle.version) {
      throw new TypeError(`bundled Provider selection identity mismatch: ${bundle.skill}`);
    }
    return {
      ...bundle,
      capabilities: {
        domains: manifest.domains,
        target_kinds: manifest.activation.target_kinds,
        profiles: manifest.provides.profiles,
        operations: manifest.provides.operations.map((operation) => operation.id),
        composers: (manifest.provides.composers ?? []).map((composer) => ({
          id: composer.id,
          supported_profiles: composer.supported_profiles,
        })),
        extensions: (manifest.composition?.extensions ?? []).map((extension) => ({
          profile: extension.profile,
          extends: extension.extends,
          ...(extension.variant_schema === undefined ? {} : { variant_schema: extension.variant_schema }),
        })),
      },
      guidance: {
        skill_path: join(root, "SKILL.md"),
        manifest_path: manifestPath,
      },
    };
  }));
}
