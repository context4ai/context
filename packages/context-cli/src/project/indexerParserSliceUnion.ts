import { buildIndexerSourceIdentityInventory, indexerProtocolDigest, type IndexerParserFactView } from "@c4a/context";
import { validateIndexerParserRuntimeSourceSlice, type IndexerParserRuntimeSourceSlice } from "./indexerParserRuntimeExecution.js";

/** Rehydrate exactly the analysis scopes used by Author preparation, rather
 * than recomputing contracts with a different TypeScript dependency context.
 */
export function unionParserSourceSlices(slices: readonly IndexerParserRuntimeSourceSlice[]): IndexerParserRuntimeSourceSlice {
  const first = slices[0];
  if (!first) throw new TypeError("Parser source union requires a non-empty scope");
  if (slices.length === 1) return first;
  const files = new Map<string, IndexerParserFactView["files"][number]>();
  const identities = new Map<string, typeof first.source_binding.source_identity_inventory.files[number]>();
  for (const slice of slices) {
    if (slice.source_binding.source_ref !== first.source_binding.source_ref || slice.source_binding.module_ref !== first.source_binding.module_ref) {
      throw new TypeError("Parser source union crosses source authority");
    }
    for (const file of slice.source_binding.source_identity_inventory.files) {
      const previous = identities.get(file.normalized_path);
      if (previous && indexerProtocolDigest(previous) !== indexerProtocolDigest(file)) throw new TypeError("Parser scopes contain conflicting file identities");
      identities.set(file.normalized_path, file);
    }
    for (const file of slice.fact_view.files) {
      const previous = files.get(file.file_ref);
      if (previous && indexerProtocolDigest(previous) !== indexerProtocolDigest(file)) throw new TypeError("Parser scopes contain conflicting facts");
      files.set(file.file_ref, file);
    }
  }
  const unique = (values: string[]) => [...new Set(values)].sort();
  const identityFiles = [...identities.values()].sort((a, b) => a.normalized_path.localeCompare(b.normalized_path));
  const identity = buildIndexerSourceIdentityInventory({ ...first.source_binding,
    source_input_digest: indexerProtocolDigest(identityFiles.map(file => ({ path: file.normalized_path, digest: file.content_digest }))),
    files: identityFiles });
  const binding = {
    source_ref: first.source_binding.source_ref, module_ref: first.source_binding.module_ref,
    entry_digests: unique(slices.flatMap(slice => slice.source_binding.entry_digests)),
    parser_lock_digests: unique(slices.flatMap(slice => slice.source_binding.parser_lock_digests)),
    import_receipt_digests: unique(slices.flatMap(slice => slice.source_binding.import_receipt_digests)),
    result_digests: unique(slices.flatMap(slice => slice.source_binding.result_digests)),
    eligible_inventory_digest: identity.inventory_digest,
    source_merge_digest: indexerProtocolDigest(unique(slices.map(slice => slice.source_binding.source_merge_digest))),
    source_toolchain_digest: indexerProtocolDigest(unique(slices.map(slice => slice.source_binding.source_toolchain_digest))),
    source_identity_inventory: identity,
  };
  const orderedFiles = [...files.values()].sort((a, b) => a.file_ref < b.file_ref ? -1 : a.file_ref > b.file_ref ? 1 : 0);
  const view = { ...first.fact_view, inventory_digest: identity.inventory_digest,
    origin_result_digests: binding.result_digests, files: orderedFiles,
    fact_set_digest: indexerProtocolDigest(orderedFiles.map(file => ({ file_ref: file.file_ref, facts: file.facts }))) };
  const { view_digest: ignored, ...payload } = view;
  void ignored;
  return validateIndexerParserRuntimeSourceSlice({ source_binding: { ...binding, binding_digest: indexerProtocolDigest(binding) },
    fact_view: { ...payload, view_digest: indexerProtocolDigest(payload) } });
}
