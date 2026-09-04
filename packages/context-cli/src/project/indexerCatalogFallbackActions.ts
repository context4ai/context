import {
  buildIndexerCatalogFallback,
  canonicalIndexerJson,
  INDEXER_CATALOG_FALLBACK_STRATEGY_ID,
  indexerInventoryMemberSchema,
  validateIndexerMainRunRequest,
  validateIndexerPartitionConvergenceRecord,
  type IndexerPartitionStrategy,
  type IndexerInventoryMember,
} from "@c4a/context";
import { acceptIndexerMainRunStore } from "./indexerMainRunStore.js";
import { assertCurrentIndexerRequirement } from "./indexerMainRunStoreActions.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${label} must be a string array`);
  }
  return value;
}

function inventoryMemberArray(value: unknown): IndexerInventoryMember[] {
  if (!Array.isArray(value)) {
    throw new TypeError("canonical_inventory_members must be an object array");
  }
  return value.map((member) => indexerInventoryMemberSchema.parse(member));
}

function partitionValidation(value: unknown): {
  stage: "partition";
  canonical_inventory_members: IndexerInventoryMember[];
  authorized_source_refs: string[];
  authorized_strategies: {
    strategy_ref: IndexerPartitionStrategy;
    strategy_digest: string;
  }[];
  required_question_target_refs?: string[];
} {
  const candidate = record(value, "catalog fallback validation");
  if (candidate.stage !== "partition" || !Array.isArray(candidate.authorized_strategies)) {
    throw new TypeError("catalog fallback validation must target the partition stage");
  }
  const requiredTargets = candidate.required_question_target_refs === undefined
    ? undefined
    : stringArray(
        candidate.required_question_target_refs,
        "required_question_target_refs",
      );
  return {
    stage: "partition",
    canonical_inventory_members: inventoryMemberArray(
      candidate.canonical_inventory_members,
    ),
    authorized_source_refs: stringArray(
      candidate.authorized_source_refs,
      "authorized_source_refs",
    ),
    authorized_strategies: candidate.authorized_strategies as {
      strategy_ref: IndexerPartitionStrategy;
      strategy_digest: string;
    }[],
    ...(requiredTargets === undefined
      ? {}
      : { required_question_target_refs: requiredTargets }),
  };
}

export async function buildProjectIndexerCatalogFallback(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "catalog fallback input");
  if (value.protocol !== "context.indexer.catalog-fallback-build-input/v1") {
    throw new TypeError(
      "catalog fallback input.protocol must be context.indexer.catalog-fallback-build-input/v1",
    );
  }
  await assertCurrentIndexerRequirement(
    input.projectRoot,
    value.requirement_set_digest,
  );
  const request = validateIndexerMainRunRequest(value.request);
  const convergence = validateIndexerPartitionConvergenceRecord(value.convergence);
  const validation = partitionValidation(value.validation);
  if (
    request.workset.stage !== "partition" ||
    request.partition_strategy_attempt?.strategy_ref.strategy_id !==
      INDEXER_CATALOG_FALLBACK_STRATEGY_ID ||
    convergence.decision !== "catalog-fallback-required" ||
    convergence.attempts.at(-1)?.attempt_digest !==
      request.partition_strategy_attempt.previous_attempt_digest ||
    canonicalIndexerJson(convergence.next_strategy_attempt) !==
      canonicalIndexerJson(request.partition_strategy_attempt)
  ) {
    throw new TypeError("catalog fallback request does not continue the persisted convergence");
  }
  const fallback = buildIndexerCatalogFallback({
    workset: request.workset,
    convergence,
    canonical_inventory_members: validation.canonical_inventory_members,
    authorized_source_refs: validation.authorized_source_refs,
    authorized_strategies: validation.authorized_strategies,
    ...(validation.required_question_target_refs === undefined
      ? {}
      : {
          required_question_target_refs:
            validation.required_question_target_refs,
        }),
  });
  const result = {
    protocol: "context.indexer.run-result/v1" as const,
    operation: "main-index" as const,
    consumed_input_view_digest: request.composition_input.view_digest,
    result: {
      protocol: "context.indexer.main-result/v1" as const,
      stage: "partition" as const,
      workset_digest: request.workset.workset_digest,
      execution_request_digest: request.execution_request_digest,
      result: fallback.partition_plan,
    },
  };
  const accepted = await acceptIndexerMainRunStore({
    projectRoot: input.projectRoot,
    workset_digest: request.workset.workset_digest,
    result,
  });
  return {
    protocol: "context.indexer.catalog-fallback-build/v1" as const,
    request,
    fallback,
    result,
    ...accepted,
    outcome: "catalog-fallback-applied" as const,
    graph_outcome: "completed" as const,
    user_gate_required: false as const,
  };
}
