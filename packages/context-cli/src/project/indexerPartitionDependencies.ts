import { indexerProtocolDigest } from "@c4a/context";
import type { ProjectIndexerMainSourceBinding } from "./indexerMainSourceAdapter.js";
import type { IndexerConsumerWorksetProjection } from "./indexerConsumerWorksetPlanner.js";

/** Bind reuse to all material visible to this shard, not a module-wide parser
 * execution receipt. Keep content and fact changes significant. */
export function partitionDependencyDigest(
  binding: ProjectIndexerMainSourceBinding,
  projection: IndexerConsumerWorksetProjection | undefined,
): string | undefined {
  if (binding.adapter !== "parser-facts" || projection === undefined || projection.unresolved) return undefined;
  const selectedFiles = new Set(projection.file_refs);
  const selectedFacts = new Set(projection.fact_items.map(item => item.fact_ref));
  const files = binding.parser_fact_view.files.filter(file => selectedFiles.has(file.file_ref));
  const identities = new Map(binding.source_identity_inventory.files.map(file => [file.normalized_path, file]));
  if (files.length !== selectedFiles.size) return undefined;
  const facts = [...binding.parser_fact_index.values()].filter(item => selectedFacts.has(item.fact.fact_ref));
  if (facts.length !== selectedFacts.size || files.some(file => !identities.has(file.normalized_path))) return undefined;
  return indexerProtocolDigest({
    source_ref: binding.source_ref, module_ref: binding.module_ref,
    files: files.map(file => ({
      file_ref: file.file_ref, path: file.normalized_path, disposition: file.disposition,
      content_digest: identities.get(file.normalized_path)!.content_digest,
    })).sort((a, b) => a.file_ref.localeCompare(b.file_ref)),
    facts: facts.map(item => item.fact).sort((a, b) => a.fact_ref.localeCompare(b.fact_ref)),
  });
}
