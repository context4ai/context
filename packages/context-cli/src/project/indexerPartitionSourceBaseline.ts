import { readIndexerParserRuntimeIndexManifest, readIndexerParserRuntimeSourceSlice } from "./indexerParserRuntimeIndex.js";
import { indexerParserTaskSelection } from "./indexerParserTaskSelection.js";
import { partitionDependencyDigest } from "./indexerPartitionDependencies.js";
import type { ProjectIndexerMainSourceBinding } from "./indexerMainSourceAdapter.js";
import type { IndexerConsumerWorksetProjection } from "./indexerConsumerWorksetPlanner.js";
import { buildIndexerPartitionInventoryFromParserFactView, type IndexerPartitionValidationInput } from "@c4a/context";

/** Recover a material baseline only from the immutable cache identified by the
 * accepted workset. An unrelated/current cache is not evidence of equivalence. */
export async function acceptedPartitionMaterialBaseline(input: {
  projectRoot: string;
  partition: IndexerPartitionValidationInput;
  projection: IndexerConsumerWorksetProjection | undefined;
}): Promise<string | undefined> {
  const { workset } = input.partition;
  if (workset.partition_input_digests.includes(workset.source_binding_digest)) return undefined;
  try {
    const manifest = await readIndexerParserRuntimeIndexManifest({ projectRoot: input.projectRoot, indexer_id: workset.indexer_id });
    if (manifest.profile_contract_digest !== workset.profile_contract_digest) return undefined;
    const slice = await readIndexerParserRuntimeSourceSlice({
      projectRoot: input.projectRoot, indexer_id: workset.indexer_id, manifest,
      source_ref: workset.source_ref, module_ref: workset.module_ref,
      selection: indexerParserTaskSelection({ ...workset,
        validation: { canonical_inventory_members: input.partition.canonical_inventory_members,
          partition_projection: input.projection } }),
    });
    const old = slice.source_binding;
    if (old.binding_digest !== workset.source_binding_digest ||
        [old.eligible_inventory_digest, old.source_merge_digest, old.source_toolchain_digest,
          old.source_identity_inventory.inventory_digest].some(digest => !workset.partition_input_digests.includes(digest))) return undefined;
    const binding: ProjectIndexerMainSourceBinding = {
      adapter: "parser-facts", source_ref: workset.source_ref, module_ref: workset.module_ref,
      profile_contract_digest: workset.profile_contract_digest,
      source_binding_digest: old.binding_digest, source_snapshot_digest: old.source_identity_inventory.source_input_digest,
      partition_inventory: buildIndexerPartitionInventoryFromParserFactView(slice.fact_view),
      partition_input_digests: workset.partition_input_digests,
      source_identity_inventory: slice.source_binding.source_identity_inventory,
      parser_fact_view: slice.fact_view,
      parser_fact_index: new Map(slice.fact_view.files.flatMap(file => file.facts.map(fact =>
        [fact.fact_ref, { file_ref: file.file_ref, fact }] as const))),
    };
    return partitionDependencyDigest(binding, input.projection);
  } catch {
    // Missing or corrupt historical evidence cannot authorize automatic rebinding.
    return undefined;
  }
}
