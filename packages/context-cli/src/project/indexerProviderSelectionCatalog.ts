import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseIndexerProviderManifest, parseIndexerRegistry,
  type IndexerProviderSelectionSemanticInput, type IndexerRegistry } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import {
  defaultCliIndexerAssetsRoot,
  type CliBundledIndexerCatalog,
} from "./indexerCliBundledProvider.js";

/** Expand only explicit references against the catalog used by the revision check.
 * The durable registry still passes its complete, unchanged validation contract. */
export function expandIndexerSelectionCatalog(
  semantic: IndexerProviderSelectionSemanticInput,
  current: IndexerRegistry,
  catalog: CliBundledIndexerCatalog,
): IndexerRegistry {
  return parseIndexerRegistry(JSON.stringify({
    protocol: current.protocol,
    requirements: current.requirements,
    indexers: semantic.indexers.map(entry => ({
      ...entry,
      providers: entry.providers.map(layer => {
        if (!("catalog_skill" in layer)) return layer;
        const matches = catalog.bundles.filter(bundle => bundle.skill === layer.catalog_skill);
        if (matches.length !== 1) throw new ContextError(ExitCode.UserError,
          `Provider catalog selection must match exactly one entry: ${layer.catalog_skill}`, {
            category: ErrorCategory.UserInputInvalid,
            reason_code: "provider-catalog-selection-invalid",
            next: "Select one exact skill from the current Action catalog and resubmit; do not guess a version.",
          });
        const { catalog_skill: skill, ...selected } = layer;
        const bundle = matches[0]!;
        return { ...selected, skill, version: bundle.version,
          integrity: bundle.integrity, distribution: bundle.distribution };
      }),
    })),
  }));
}

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
