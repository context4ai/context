import { loadIndexerRegistry } from "@c4a/context";
import {
  buildProjectIndexerMainPartitionWorksets,
  buildProjectIndexerQuestionTargetInventory,
} from "./indexerMainLifecycleActions.js";
import { prepareIndexerMainRunStore } from "./indexerMainRunStore.js";
import { currentLedger } from "./indexerMainRunStoreRecords.js";

/** Reconcile with the accepted cache; never clear it to change a scope. */
export async function preparePartitionStage(projectRoot: string) {
  const loaded = await loadIndexerRegistry(projectRoot);
  const questionTargets = await buildProjectIndexerQuestionTargetInventory({
    projectRoot,
    value: {
      protocol: "context.indexer.question-target-inventory-input/v1",
      requirement_set_digest: loaded.requirementSetDigest,
    },
  });
  const partition = await buildProjectIndexerMainPartitionWorksets({
    projectRoot,
    value: {
      protocol: "context.indexer.main-partition-workset-build-input/v1",
      question_target_inventory: questionTargets,
    },
  });
  await prepareIndexerMainRunStore({
    projectRoot,
    workset_set: partition.workset_set,
    run_specs: partition.run_specs,
  });
  return currentLedger(projectRoot);
}
