import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertManagedDocumentPath, readSessionChanges, indexerProtocolDigest } from "@c4a/context";
import { loadIndexerCustomization } from "./indexerCustomization.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from "./indexerCurrentPrimaryAuthority.js";
import { currentCliInstructionDescriptors } from "./indexerCurrentInstructionMaterialization.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";

/** Resolve current selected writing resources even for an explicit page revise
 * with no source-update request. No Parser or remote acquisition runs here. */
export async function approvedRevisionContext(root: string, target: { source_refs: string[]; markdown: string }) {
  const { registry } = await loadIndexerRegistry(root);
  const requirements = registry.requirements.filter((requirement) => requirement.target_scope.targets.some((source) =>
    target.source_refs.some((ref) => ref === source.source_ref || ref.startsWith(`${source.source_ref}#`) || ref.startsWith(`${source.source_ref}/`))));
  const ids = new Set(requirements.map((item) => item.id));
  const indexers = registry.indexers.filter((indexer) => indexer.requirement_bindings.some((binding) => ids.has(binding.requirement_ref) && binding.role === "primary"));
  const providers = [];
  for (const indexer of indexers) {
    const authority = await resolveCurrentProjectIndexerPrimaryAuthority({ projectRoot: root, registry, indexer_id: indexer.id });
    const customization = await loadIndexerCustomization({ workspaceRoot: root, projectRef: root,
      indexer, manifest: authority.manifest, providerIntegrity: authority.provider.integrity });
    const resources = [];
    for (const resource of currentCliInstructionDescriptors({ authority, customization, composerId: null })) {
      const path = resource.location === "workspace"
        ? join(root, "src/indexer", indexer.id, resource.path)
        : join(resource.bundle_root!, resource.path);
      resources.push({ provider: resource.provider_id, path, digest: resource.digest,
        content: await readFile(path, "utf8") });
    }
    providers.push({ indexer_id: indexer.id, profile: indexer.profile, provider: authority.provider,
      reader_profile: authority.profile, resources,
      customization });
  }
  const sources = await Promise.all([...new Set(target.source_refs.map((ref) => ref.split("#")[0]!))]
    .filter((ref) => /^(note|sessions):/u.test(ref)).map(async (source_ref) => {
      const separator = source_ref.indexOf(":");
      const type = source_ref.slice(0, separator) as "note" | "sessions";
      const name = source_ref.slice(separator + 1);
      const path = await assertManagedDocumentPath(root, type, name);
      const markdown = await readFile(path, "utf8");
      const changes = type === "sessions" ? readSessionChanges(markdown) : undefined;
      return { source_ref, path, digest: indexerProtocolDigest(markdown),
        ...(changes === undefined ? {} : { changes }) };
    }));
  return { requirements, providers, sources,
    current_sections: approvedContextSectionsInMarkdown(target.markdown).map((section) => ({
      id: section.id, kind: section.kind, source_refs: section.refs, markdown: section.readerVisibleBody,
    })) };
}
