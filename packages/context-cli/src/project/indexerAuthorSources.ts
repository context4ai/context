import {
  buildIndexerPartitionInventoryFromParserFactView,
  buildIndexerSourceIdentityInventory,
  indexerProtocolDigest,
  type IndexerPartitionValidationInput,
} from "@c4a/context";
import {
  assertProjectIndexerMainSourceBinding,
  resolveProjectIndexerMainSourceBinding,
  type ProjectIndexerMainSourceBinding,
} from "./indexerMainSourceAdapter.js";
import {
  validateIndexerConsumerWorksetProjection,
  type IndexerConsumerWorksetProjection,
} from "./indexerConsumerWorksetPlanner.js";
import { indexerParserTaskSelection } from "./indexerParserTaskSelection.js";

function mergeFacts<T extends { fact_ref: string }>(left: readonly T[], right: readonly T[]): T[] {
  const facts = new Map(left.map(fact => [fact.fact_ref, fact]));
  for (const fact of right) {
    const previous = facts.get(fact.fact_ref);
    if (previous && indexerProtocolDigest(previous) !== indexerProtocolDigest(fact)) {
      throw new TypeError("Author source union contains conflicting fact versions");
    }
    facts.set(fact.fact_ref, fact);
  }
  return [...facts.values()].sort((a, b) => a.fact_ref < b.fact_ref ? -1 : a.fact_ref > b.fact_ref ? 1 : 0);
}

/** Reuse the committed Partition selection, not a second source-wide planner. */
export function createIndexerAuthorSourceResolver(input: {
  projectRoot: string;
  projections: ReadonlyMap<string, IndexerConsumerWorksetProjection>;
}) {
  const bindings = new Map<string, Promise<ProjectIndexerMainSourceBinding>>();
  return async (partition: IndexerPartitionValidationInput) => {
    const workset = partition.workset;
    const isDocument = /^(file|lark|note|sessions):/u.test(workset.source_ref);
    const projection = input.projections.get(workset.workset_digest);
    if (!isDocument && projection === undefined) {
      throw new TypeError("Author preparation requires the current Partition consumer projection");
    }
    const selection = isDocument ? undefined : indexerParserTaskSelection({
      stage: "partition", source_ref: workset.source_ref, module_ref: workset.module_ref,
      validation: {
        canonical_inventory_members: partition.canonical_inventory_members,
        partition_projection: projection,
      },
    });
    const key = indexerProtocolDigest({
      indexer_id: workset.indexer_id, source_ref: workset.source_ref,
      module_ref: workset.module_ref, profile_contract_digest: workset.profile_contract_digest,
      selection: selection ?? null,
    });
    let pending = bindings.get(key);
    if (pending === undefined) {
      pending = resolveProjectIndexerMainSourceBinding({
        projectRoot: input.projectRoot, indexer_id: workset.indexer_id,
        source_ref: workset.source_ref, module_ref: workset.module_ref,
        profile_contract_digest: workset.profile_contract_digest,
        ...(selection === undefined ? {} : { parser_selection: selection }),
      });
      bindings.set(key, pending);
    }
    const binding = await pending;
    assertProjectIndexerMainSourceBinding({ workset, binding, partition_projection: projection });
    if (binding.adapter === "parser-facts") {
      validateIndexerConsumerWorksetProjection({
        value: projection, factView: binding.parser_fact_view,
        inventory: partition.canonical_inventory_members,
      });
    }
    return binding;
  };
}

/** Converged Subjects can span several Partition tasks from the same source. */
export function mergeIndexerAuthorSourceBindings(
  bindings: readonly ProjectIndexerMainSourceBinding[],
): ProjectIndexerMainSourceBinding {
  const first = bindings[0];
  if (first === undefined) throw new TypeError("Author Subject has no primary source");
  for (const binding of bindings) {
    if (binding.adapter !== first.adapter || binding.source_ref !== first.source_ref ||
        binding.module_ref !== first.module_ref ||
        binding.source_binding_digest !== first.source_binding_digest ||
        binding.profile_contract_digest !== first.profile_contract_digest) {
      throw new TypeError("Author source union crosses source authority");
    }
  }
  if (first.adapter !== "parser-facts" || bindings.every((binding) => binding === first)) return first;
  const filesByRef = new Map(first.parser_fact_view.files.map((file) => [file.file_ref, file]));
  const identityFiles = new Map(first.source_identity_inventory.files.map(file => [file.normalized_path, file]));
  const factIndex = new Map(first.parser_fact_index);
  for (const binding of bindings) {
    if (binding.adapter !== "parser-facts") continue;
    for (const file of binding.parser_fact_view.files) {
      const previous = filesByRef.get(file.file_ref);
      filesByRef.set(file.file_ref, previous ? { ...file, facts: mergeFacts(previous.facts, file.facts) } : file);
    }
    for (const file of binding.source_identity_inventory.files) {
      const previous = identityFiles.get(file.normalized_path);
      if (previous && previous.content_digest !== file.content_digest) {
        throw new TypeError("Author source union contains conflicting file versions");
      }
      identityFiles.set(file.normalized_path, previous ? { ...file, facts: mergeFacts(previous.facts, file.facts) } : file);
    }
    for (const [ref, fact] of binding.parser_fact_index) factIndex.set(ref, fact);
  }
  const files = [...filesByRef.values()].sort((left, right) =>
    left.file_ref < right.file_ref ? -1 : left.file_ref > right.file_ref ? 1 : 0
  );
  const { view_digest: _digest, ...header } = first.parser_fact_view;
  void _digest;
  const payload = {
    ...header, files,
    fact_set_digest: indexerProtocolDigest(files.map((file) => ({ file_ref: file.file_ref, facts: file.facts }))),
  };
  const view = { ...payload, view_digest: indexerProtocolDigest(payload) };
  return {
    ...first, parser_fact_view: view, parser_fact_index: factIndex,
    source_identity_inventory: buildIndexerSourceIdentityInventory({
      ...first.source_identity_inventory,
      files: [...identityFiles.values()],
    }),
    partition_inventory: buildIndexerPartitionInventoryFromParserFactView(view),
  };
}
