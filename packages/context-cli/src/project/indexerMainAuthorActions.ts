import { type IndexerPartitionValidationInput } from "@c4a/context";
import type { IndexerConsumerWorksetProjection } from "./indexerConsumerWorksetPlanner.js";
import { prepareCurrentProjectIndexerAuthorRuns } from "./indexerCurrentAuthorPreparation.js";
import { parseProjectIndexerTargetResolutionViewBindings } from "./indexerAuthorQuestionTargets.js";
import {
  array,
  assertCurrentRequirement,
  assertRequirementRefs,
  protocol,
  record,
} from "./indexerMainLifecycleSupport.js";
import { buildProjectIndexerQuestionTargetInventory } from
  "./indexerQuestionTargetInventoryActions.js";

export async function buildProjectIndexerMainAuthorWorksets(input: {
  projectRoot: string;
  value: unknown;
  source_partitions?: readonly IndexerPartitionValidationInput[];
  source_projections?: ReadonlyMap<string, IndexerConsumerWorksetProjection>;
  origins_by_group_ref?: ReadonlyMap<string, readonly {
    partition_workset_digest: string;
    group_key: string;
  }[]>;
}) {
  const value = record(input.value, "author workset input");
  protocol(
    value,
    "context.indexer.main-author-workset-build-input/v1",
    "author workset input",
  );
  const partitions = array(
    value.partitions,
    "author workset input.partitions",
  ) as unknown as IndexerPartitionValidationInput[];
  const requirementDigests = new Set(partitions.map((partition) =>
    partition.workset.requirement_set_digest
  ));
  if (requirementDigests.size !== 1) {
    throw new TypeError("author workset partitions must target one requirement set");
  }
  const registry = await assertCurrentRequirement(
    input.projectRoot,
    [...requirementDigests][0],
  );
  assertRequirementRefs(
    registry,
    partitions.map((partition) => partition.workset.requirement_ref),
  );
  const targetResolutionViews = parseProjectIndexerTargetResolutionViewBindings(array(
    value.target_resolution_views,
    "author workset input.target_resolution_views",
  ));
  const conflicts = targetResolutionViews.flatMap((binding) => {
    const view = binding.view;
    return view.entries.flatMap((entry) => entry.state === "ambiguous" ? [{
      group_ref: binding.group_ref,
      query_ref: entry.query_ref,
      conflicting_node_refs: entry.conflicting_node_refs,
    }] : []);
  });
  if (conflicts.length > 0) {
    return {
      protocol: "context.indexer.target-resolution-outcome/v1" as const,
      outcome: "index-target-resolution-ambiguous" as const,
      conflicts,
      message: "an exact SubjectKey query resolves to multiple current Nodes",
      graph_outcome: "blocked" as const,
    };
  }
  const questionTargets = await buildProjectIndexerQuestionTargetInventory({
    projectRoot: input.projectRoot,
    value: {
      protocol: "context.indexer.question-target-inventory-input/v1",
      requirement_set_digest: [...requirementDigests][0],
    },
  });
  const built = await prepareCurrentProjectIndexerAuthorRuns({
    projectRoot: input.projectRoot,
    registry,
    partitions,
    question_target_inventory: questionTargets,
    target_resolution_views: targetResolutionViews,
    ...(input.source_projections === undefined ? {} : { source_projections: input.source_projections }),
    ...(input.source_partitions === undefined
      ? {}
      : { source_partitions: input.source_partitions }),
    ...(input.origins_by_group_ref === undefined
      ? {}
      : { origins_by_group_ref: input.origins_by_group_ref }),
  });
  return {
    protocol: "context.indexer.main-author-workset-build/v1" as const,
    ...built,
    graph_outcome: "completed" as const,
  };
}
