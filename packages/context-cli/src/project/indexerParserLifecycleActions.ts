import {
  buildIndexerCommunityParserCoordinateMappings,
  buildIndexerParserDependencyIntentSet,
  buildIndexerParserResolutionLocks,
  indexerParserExecutionEntryDigest,
  indexerProtocolDigest,
  loadSourcesRegistry,
  validateIndexerParserExecutionPlan,
  type IndexerDependencyAuthorizationReceipt,
  type IndexerParserCoordinateMapping,
  type IndexerParserResolutionLock,
} from "@c4a/context";
import {
  bundledIndexerProfileContract,
} from "./indexerBaseContracts.js";
import {
  buildProjectIndexerParserExecutionPlan,
  projectIndexerApplicableParserCapabilities,
} from "./indexerParserExecutionPlanning.js";
import { indexerRequirementSourceBoundaryDigest } from "./indexerRequirementProject.js";
import {
  executeProjectIndexerParserPlan,
} from "./indexerParserRuntimeExecution.js";
import { loadProjectIndexerParser } from "./indexerParserRuntimeImport.js";
import {
  materializeProjectIndexerParserEntryInput,
  materializeProjectIndexerParserFiles,
  type ProjectIndexerParserFilesMaterialization,
} from "./indexerParserSourceMaterialization.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function indexerId(value: Record<string, unknown>, label: string): string {
  if (typeof value.indexer_id !== "string" || value.indexer_id.length === 0) {
    throw new TypeError(`${label}.indexer_id must be a string`);
  }
  return value.indexer_id;
}

export async function buildProjectIndexerParserPlanAction(input: {
  projectRoot: string;
  value: unknown;
  materialized?: ProjectIndexerParserFilesMaterialization;
}) {
  const value = record(input.value, "parser execution plan build input");
  if (value.protocol !== "context.indexer.parser-execution-plan-build-input/v1") {
    throw new TypeError(
      "parser execution plan build input.protocol must be context.indexer.parser-execution-plan-build-input/v1",
    );
  }
  const currentIndexerId = indexerId(value, "parser execution plan build input");
  const registry = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const profileContract = bundledIndexerProfileContract();
  const materialized = input.materialized ??
    await materializeProjectIndexerParserFiles({
      projectRoot: input.projectRoot,
      indexer_id: currentIndexerId,
      profile_contract: profileContract,
    });
  return buildProjectIndexerParserExecutionPlan({
    profile_contract: profileContract,
    profile_id: materialized.profile_id,
    source_registry_digest: indexerRequirementSourceBoundaryDigest(registry),
    authorized_files: materialized.files,
    parser_locks: array(
      value.parser_locks,
      "parser execution plan build input.parser_locks",
    ) as IndexerParserResolutionLock[],
  });
}

export async function executeProjectIndexerParserPlanAction(input: {
  projectRoot: string;
  value: unknown;
  materialized?: ProjectIndexerParserFilesMaterialization;
}) {
  const value = record(input.value, "parser runtime execution input");
  if (value.protocol !== "context.indexer.parser-runtime-execution-input/v1") {
    throw new TypeError(
      "parser runtime execution input.protocol must be context.indexer.parser-runtime-execution-input/v1",
    );
  }
  const currentIndexerId = indexerId(value, "parser runtime execution input");
  const plan = validateIndexerParserExecutionPlan(
    record(value.execution_plan, "parser runtime execution input.execution_plan"),
  );
  const registry = await loadSourcesRegistry({ rootDir: input.projectRoot });
  if (plan.source_registry_digest !== indexerRequirementSourceBoundaryDigest(registry)) {
    throw new TypeError("parser execution plan is stale against the current source registry");
  }
  const profileContract = bundledIndexerProfileContract();
  const materialized = input.materialized ??
    await materializeProjectIndexerParserFiles({
      projectRoot: input.projectRoot,
      indexer_id: currentIndexerId,
      profile_contract: profileContract,
    });
  const mappings = array(
    value.mappings,
    "parser runtime execution input.mappings",
  ) as IndexerParserCoordinateMapping[];
  const locks = array(
    value.locks,
    "parser runtime execution input.locks",
  ) as IndexerParserResolutionLock[];
  const requirementByCapability = new Map(
    profileContract.profiles.find((profile) => profile.id === materialized.profile_id)!
      .parser_requirements.map((requirement) => [requirement.capability, requirement]),
  );
  const mappingByCapability = new Map(mappings.map((mapping) => [mapping.capability, mapping]));
  const lockByCapability = new Map(locks.map((lock) => [lock.capability, lock]));
  const entryInputs = [];
  for (const entry of plan.entries) {
    const requirement = requirementByCapability.get(entry.capability);
    const mapping = mappingByCapability.get(entry.capability);
    const lock = lockByCapability.get(entry.capability);
    if (requirement === undefined || mapping === undefined || lock === undefined) {
      throw new TypeError(`parser runtime resolution set does not satisfy ${entry.capability}`);
    }
    const loaded = await loadProjectIndexerParser({
      requirement,
      mapping,
      lock,
    });
    entryInputs.push(await materializeProjectIndexerParserEntryInput({
      projectRoot: input.projectRoot,
      entry_digest: indexerParserExecutionEntryDigest(entry),
      capability: entry.capability,
      source_ref: entry.source_ref,
      normalized_paths: entry.files.map((file) => file.normalized_path),
      loaded_module: loaded.module,
    }));
  }
  return executeProjectIndexerParserPlan({
    projectRoot: input.projectRoot,
    profile_contract: profileContract,
    profile_id: materialized.profile_id,
    execution_plan: plan,
    dependencies: value.dependencies,
    mappings,
    locks,
    entry_inputs: entryInputs,
  });
}

export async function buildProjectIndexerParserDependencyIntentsAction(input: {
  projectRoot: string;
  value: unknown;
  materialized?: ProjectIndexerParserFilesMaterialization;
}) {
  const value = record(input.value, "parser dependency intent input");
  if (value.protocol !== "context.indexer.parser-dependency-intent-input/v1") {
    throw new TypeError(
      "parser dependency intent input.protocol must be context.indexer.parser-dependency-intent-input/v1",
    );
  }
  const currentIndexerId = indexerId(value, "parser dependency intent input");
  const registry = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const profileContract = bundledIndexerProfileContract();
  const materialized = input.materialized ??
    await materializeProjectIndexerParserFiles({
      projectRoot: input.projectRoot,
      indexer_id: currentIndexerId,
      profile_contract: profileContract,
    });
  const profile = profileContract.profiles.find((candidate) =>
    candidate.id === materialized.profile_id
  );
  if (profile === undefined) {
    throw new TypeError(`unknown Indexer profile ${materialized.profile_id}`);
  }
  const capabilities = projectIndexerApplicableParserCapabilities({
    profile_contract: profileContract,
    profile_id: materialized.profile_id,
    authorized_files: materialized.files,
  });
  const selected = new Set(capabilities);
  const requirements = profile.parser_requirements.filter((requirement) =>
    selected.has(requirement.capability)
  );
  const resolution = record(value.resolution, "parser dependency intent input.resolution");
  let mappings: IndexerParserCoordinateMapping[];
  if (resolution.kind === "community-direct") {
    if (typeof resolution.registry !== "string") {
      throw new TypeError("community parser resolution.registry must be a string");
    }
    mappings = buildIndexerCommunityParserCoordinateMappings({
      requirements,
      registry: resolution.registry,
    });
  } else if (resolution.kind === "mapped") {
    const supplied = array(
      resolution.mappings,
      "mapped parser resolution.mappings",
    ) as IndexerParserCoordinateMapping[];
    const byCapability = new Map(supplied.map((mapping) => [mapping.capability, mapping]));
    mappings = capabilities.map((capability) => {
      const mapping = byCapability.get(capability);
      if (mapping === undefined) {
        throw new TypeError(`mapped parser resolution lacks ${capability}`);
      }
      return mapping;
    });
  } else {
    throw new TypeError("parser dependency resolution.kind must be community-direct or mapped");
  }
  const authorizationReceipt = value.authorization_receipt as
    IndexerDependencyAuthorizationReceipt | undefined;
  const dependencies = buildIndexerParserDependencyIntentSet({
    requirements,
    mappings,
    importers: ["src/indexers.yaml"],
    ...(authorizationReceipt === undefined
      ? {}
      : { authorization_receipt: authorizationReceipt }),
  });
  const locks = authorizationReceipt === undefined
    ? []
    : buildIndexerParserResolutionLocks({
        requirements,
        mappings,
        authorization_receipt: authorizationReceipt,
      });
  const payload = {
    profile_contract_digest: profileContract.contract_digest,
    source_registry_digest: indexerRequirementSourceBoundaryDigest(registry),
    indexer_id: currentIndexerId,
    profile_id: materialized.profile_id,
    applicable_capabilities: capabilities,
    mappings,
    dependencies,
    locks,
  };
  return { ...payload, projection_digest: indexerProtocolDigest(payload) };
}
