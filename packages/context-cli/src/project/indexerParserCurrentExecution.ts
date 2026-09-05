import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  authorizeIndexerDependencies,
  indexerProtocolDigest,
  validateIndexerParserFactView,
  type IndexerParserCoordinateMapping,
} from "@c4a/context";
import {
  buildProjectIndexerParserDependencyIntentsAction,
  buildProjectIndexerParserPlanAction,
  executeProjectIndexerParserPlanAction,
} from "./indexerParserLifecycleActions.js";
import { LIFECYCLE_ROOT } from "./lifecyclePaths.js";
import {
  inspectInstalledIndexerParserPackage,
  type InstalledIndexerParserPackage,
} from "./indexerParserRuntimeImport.js";
import {
  type IndexerParserRuntimeExecutionReceipt,
  type IndexerParserRuntimeSourceSlice,
  validateIndexerParserRuntimeExecutionReceipt,
  validateIndexerParserRuntimeSourceSlice,
} from "./indexerParserRuntimeExecution.js";
import { bundledIndexerProfileContract } from "./indexerBaseContracts.js";
import {
  inspectProjectIndexerParserSourceAuthority,
  materializeProjectIndexerParserFiles,
} from "./indexerParserSourceMaterialization.js";
import { recordContextDebugPerformance } from "./debugTrace.js";
import {
  readIndexerParserRuntimeExecution,
  readIndexerParserRuntimeIndexManifest,
  readIndexerParserRuntimeSourceSlice,
  readIndexerParserRuntimeSourceMetadata,
  writeIndexerParserRuntimeIndex,
  type IndexerParserRuntimeIndexManifest,
  type IndexerParserSourceSelection,
} from "./indexerParserRuntimeIndex.js";
import { parserRuntimeReadCounters } from "./indexerParserRuntimeChunk.js";

const CACHE_ROOT = join(LIFECYCLE_ROOT, "indexer-parser-executions");
const inFlight = new Map<string, Promise<IndexerParserRuntimeExecutionReceipt>>();

function legacyCachePath(projectRoot: string, indexerId: string): string {
  const identity = createHash("sha256").update(indexerId).digest("hex");
  return join(projectRoot, CACHE_ROOT, `${identity}.json`);
}

function legacyCacheMetadataPath(projectRoot: string, indexerId: string): string {
  const identity = createHash("sha256").update(indexerId).digest("hex");
  return join(projectRoot, CACHE_ROOT, `${identity}.meta.json`);
}

function parserPackageSetDigest(packages: readonly InstalledIndexerParserPackage[]): string {
  return indexerProtocolDigest([...packages].sort((left, right) =>
    left.package.localeCompare(right.package)
  ));
}

async function readAuthorizedIndex(input: {
  projectRoot: string;
  indexer_id: string;
  profile_contract_digest: string;
  require_current_sources?: boolean;
}): Promise<IndexerParserRuntimeIndexManifest | undefined> {
  try {
    const manifest = await readIndexerParserRuntimeIndexManifest(input);
    if (manifest.indexer_id !== input.indexer_id) return undefined;
    const authority = await inspectProjectIndexerParserSourceAuthority({
      projectRoot: input.projectRoot,
      indexer_id: input.indexer_id,
    });
    if (
      manifest.indexer_digest !== authority.indexer_digest ||
      (input.require_current_sources !== false &&
        manifest.source_registry_digest !== authority.source_registry_digest) ||
      manifest.profile_contract_digest !== input.profile_contract_digest
    ) return undefined;
    const currentPackages = await Promise.all(manifest.parser_packages.map((candidate) =>
      inspectInstalledIndexerParserPackage({
        package: candidate.package,
        version: candidate.version,
      })
    ));
    if (
      parserPackageSetDigest(currentPackages) !== manifest.parser_package_set_digest ||
      parserPackageSetDigest(manifest.parser_packages) !== manifest.parser_package_set_digest
    ) return undefined;
    return manifest;
  } catch {
    return undefined;
  }
}

async function readReusableExecution(input: {
  projectRoot: string;
  indexer_id: string;
  profile_contract_digest: string;
  parser_packages: readonly InstalledIndexerParserPackage[];
}): Promise<IndexerParserRuntimeExecutionReceipt | undefined> {
  const manifest = await readAuthorizedIndex({
    ...input,
    require_current_sources: false,
  });
  if (
    manifest === undefined ||
    parserPackageSetDigest(input.parser_packages) !== manifest.parser_package_set_digest
  ) return undefined;
  try {
    const execution = validateIndexerParserRuntimeExecutionReceipt(
      await readIndexerParserRuntimeExecution({ ...input, manifest }),
    );
    return execution.execution_digest === manifest.execution_digest ? execution : undefined;
  } catch {
    return undefined;
  }
}

async function readCachedExecution(input: {
  projectRoot: string;
  indexer_id: string;
  profile_contract_digest: string;
}): Promise<IndexerParserRuntimeExecutionReceipt | undefined> {
  const started = performance.now();
  const counters = parserRuntimeReadCounters();
  const manifest = await readAuthorizedIndex(input);
  if (manifest === undefined) {
    await recordContextDebugPerformance({
      projectRoot: input.projectRoot,
      operation: "parser.cache-access",
      durationMs: performance.now() - started,
      outcome: "success",
      counters: {
        parser_cache_read_count: 1,
        parser_cache_hit_count: 0,
        full_fact_blob_decode_count: 0,
      },
      data: { cache_outcome: "miss", read_mode: "full-execution" },
    });
    return undefined;
  }
  try {
    const execution = validateIndexerParserRuntimeExecutionReceipt(
      await readIndexerParserRuntimeExecution({ ...input, manifest, counters }),
    );
    if (execution.execution_digest !== manifest.execution_digest) return undefined;
    await recordContextDebugPerformance({
      projectRoot: input.projectRoot,
      operation: "parser.cache-access",
      durationMs: performance.now() - started,
      outcome: "success",
      counters: {
        parser_cache_read_count: 1,
        parser_cache_hit_count: 1,
        ...counters,
      },
      data: { cache_outcome: "hit", read_mode: "full-execution" },
    });
    return execution;
  } catch {
    return undefined;
  }
}

async function readCachedSourceSlice(input: {
  projectRoot: string;
  indexer_id: string;
  profile_contract_digest: string;
  source_ref: string;
  module_ref: string | null;
  selection?: IndexerParserSourceSelection;
}): Promise<IndexerParserRuntimeSourceSlice | undefined> {
  const started = performance.now();
  const counters = parserRuntimeReadCounters();
  const manifest = await readAuthorizedIndex(input);
  if (manifest === undefined) {
    await recordContextDebugPerformance({
      projectRoot: input.projectRoot,
      operation: "parser.cache-access",
      durationMs: performance.now() - started,
      outcome: "success",
      counters: {
        parser_cache_read_count: 1,
        parser_cache_hit_count: 0,
        parser_source_chunk_decode_count: 0,
        full_fact_blob_decode_count: 0,
      },
      data: { cache_outcome: "miss", read_mode: "source-slice" },
    });
    return undefined;
  }
  try {
    const slice = await readIndexerParserRuntimeSourceSlice({ ...input, manifest, counters });
    const indexed = manifest.sources.find((source) =>
      source.source_ref === input.source_ref && source.module_ref === input.module_ref
    );
    if (
      indexed === undefined ||
      indexed.binding_digest !== slice.source_binding.binding_digest ||
      (input.selection === undefined && indexed.fact_view_digest !== slice.fact_view.view_digest)
    ) return undefined;
    // Source metadata is committed by the manifest/chunk digest. Validate only the
    // selected payload here, not the complete source identity inventory per task.
    validateIndexerParserFactView(slice.fact_view);
    await recordContextDebugPerformance({
      projectRoot: input.projectRoot,
      operation: "parser.cache-access",
      durationMs: performance.now() - started,
      outcome: "success",
      counters: {
        parser_cache_read_count: 1,
        parser_cache_hit_count: 1,
        parser_source_chunk_decode_count: counters.parser_source_metadata_decode_count,
        ...counters,
      },
      data: { cache_outcome: "hit", read_mode: "source-slice" },
    });
    return slice;
  } catch (error) {
    if (error instanceof RangeError) throw error;
    await recordContextDebugPerformance({
      projectRoot: input.projectRoot,
      operation: "parser.cache-access",
      durationMs: performance.now() - started,
      outcome: "error",
      counters: {
        parser_cache_read_count: 1,
        parser_cache_hit_count: 0,
        parser_source_chunk_decode_count: 0,
        ...counters,
      },
      data: { cache_outcome: "corrupt", read_mode: "source-slice" },
    });
    return undefined;
  }
}

function uniquePackageCoordinates(mappings: readonly IndexerParserCoordinateMapping[]) {
  const coordinates = new Map<string, { package: string; version: string }>();
  for (const mapping of mappings) {
    const coordinate = mapping.actual_coordinate;
    const previous = coordinates.get(coordinate.package);
    if (previous !== undefined && previous.version !== coordinate.version) {
      throw new TypeError(
        `parser mappings disagree on package version: ${coordinate.package}`,
      );
    }
    coordinates.set(coordinate.package, {
      package: coordinate.package,
      version: coordinate.version,
    });
  }
  return [...coordinates.values()].sort((left, right) =>
    left.package.localeCompare(right.package)
  );
}

async function executeCurrent(input: {
  projectRoot: string;
  indexer_id: string;
}): Promise<IndexerParserRuntimeExecutionReceipt> {
  const profileContract = bundledIndexerProfileContract();
  const cached = await readCachedExecution({
    projectRoot: input.projectRoot,
    indexer_id: input.indexer_id,
    profile_contract_digest: profileContract.contract_digest,
  });
  if (cached !== undefined) return cached;
  const materialized = await materializeProjectIndexerParserFiles({
    projectRoot: input.projectRoot,
    indexer_id: input.indexer_id,
    profile_contract: profileContract,
  });
  const dependencyInput = {
    protocol: "context.indexer.parser-dependency-intent-input/v1",
    indexer_id: input.indexer_id,
    resolution: { kind: "community-direct", registry: "npm" },
  };
  const preview = await buildProjectIndexerParserDependencyIntentsAction({
    projectRoot: input.projectRoot,
    value: dependencyInput,
    materialized,
  });
  if (preview.mappings.length === 0) {
    throw new TypeError(`Indexer ${input.indexer_id} has no applicable parser capability`);
  }
  const resolutions = await Promise.all(
    uniquePackageCoordinates(preview.mappings).map(inspectInstalledIndexerParserPackage),
  );
  const previousExecution = await readReusableExecution({
    projectRoot: input.projectRoot,
    indexer_id: input.indexer_id,
    profile_contract_digest: profileContract.contract_digest,
    parser_packages: resolutions,
  });
  const authorization = authorizeIndexerDependencies({
    dependencies: preview.dependencies,
    resolutions,
    authority_ref: "context-cli:bundled-indexer-parsers",
    authority_scope_digest: indexerProtocolDigest({
      parser_packages: resolutions,
      profile_contract_digest: preview.profile_contract_digest,
    }),
  });
  const locked = await buildProjectIndexerParserDependencyIntentsAction({
    projectRoot: input.projectRoot,
    value: {
      ...dependencyInput,
      authorization_receipt: authorization.receipt,
    },
    materialized,
  });
  const plan = await buildProjectIndexerParserPlanAction({
    projectRoot: input.projectRoot,
    value: {
      protocol: "context.indexer.parser-execution-plan-build-input/v1",
      indexer_id: input.indexer_id,
      parser_locks: locked.locks,
    },
    materialized,
    ...(previousExecution === undefined ? {} : { previous_execution: previousExecution }),
  });
  const execution = await executeProjectIndexerParserPlanAction({
    projectRoot: input.projectRoot,
    value: {
      protocol: "context.indexer.parser-runtime-execution-input/v1",
      indexer_id: input.indexer_id,
      execution_plan: plan,
      dependencies: locked.dependencies,
      mappings: locked.mappings,
      locks: locked.locks,
    },
    materialized,
  });
  const parserPackages = [...resolutions].sort((left, right) =>
    left.package.localeCompare(right.package)
  );
  await writeIndexerParserRuntimeIndex({
    projectRoot: input.projectRoot,
    indexer_id: input.indexer_id,
    indexer_digest: indexerProtocolDigest(materialized.indexer),
    source_registry_digest: plan.source_registry_digest,
    parser_packages: parserPackages,
    parser_package_set_digest: parserPackageSetDigest(parserPackages),
    execution,
  });
  await Promise.all([
    rm(legacyCachePath(input.projectRoot, input.indexer_id), { force: true }),
    rm(legacyCacheMetadataPath(input.projectRoot, input.indexer_id), { force: true }),
  ]);
  return execution;
}

export async function ensureCurrentProjectIndexerParserExecution(input: {
  projectRoot: string;
  indexer_id: string;
}): Promise<IndexerParserRuntimeExecutionReceipt> {
  const key = `${input.projectRoot}\u0000${input.indexer_id}`;
  const active = inFlight.get(key);
  if (active !== undefined) return active;
  const next = executeCurrent(input).finally(() => inFlight.delete(key));
  inFlight.set(key, next);
  return next;
}

export async function ensureCurrentProjectIndexerParserSourceSlice(input: {
  projectRoot: string;
  indexer_id: string;
  source_ref: string;
  module_ref: string | null;
  profile_contract_digest: string;
  selection?: IndexerParserSourceSelection;
}): Promise<IndexerParserRuntimeSourceSlice> {
  const cached = await readCachedSourceSlice(input);
  if (cached !== undefined) return cached;
  const execution = await ensureCurrentProjectIndexerParserExecution({
    projectRoot: input.projectRoot,
    indexer_id: input.indexer_id,
  });
  if (input.selection !== undefined) {
    const manifest = await readIndexerParserRuntimeIndexManifest(input);
    return readIndexerParserRuntimeSourceSlice({ ...input, manifest });
  }
  const sourceBinding = execution.source_bindings.find((binding) =>
    binding.source_ref === input.source_ref && binding.module_ref === input.module_ref
  );
  const expectedModules = input.module_ref === null ? [] : [input.module_ref];
  const factView = execution.fact_views.find((view) =>
    view.authorized_scope.source_ref === input.source_ref &&
    view.authorized_scope.module_refs.length === expectedModules.length &&
    view.authorized_scope.module_refs.every((value, index) =>
      value === expectedModules[index]
    )
  );
  if (sourceBinding === undefined || factView === undefined) {
    throw new TypeError("parser runtime execution has no exact source slice");
  }
  return validateIndexerParserRuntimeSourceSlice({
    source_binding: sourceBinding,
    fact_view: factView,
  });
}

export async function ensureCurrentProjectIndexerParserSourceIdentity(input: {
  projectRoot: string;
  indexer_id: string;
  source_ref: string;
  module_ref: string | null;
  profile_contract_digest: string;
}) {
  const started = performance.now();
  const counters = parserRuntimeReadCounters();
  let manifest = await readAuthorizedIndex(input);
  if (manifest !== undefined) {
    try {
      const metadata = await readIndexerParserRuntimeSourceMetadata({ ...input, manifest, counters });
      await recordContextDebugPerformance({
        projectRoot: input.projectRoot, operation: "parser.cache-access",
        durationMs: performance.now() - started, outcome: "success",
        counters: { ...counters, parser_cache_read_count: 1, parser_cache_hit_count: 1 },
        data: { cache_outcome: "hit", read_mode: "source-identity" },
      });
      return metadata.source_binding.source_identity_inventory;
    } catch {
      // A corrupt identity chunk must be rebuilt from the current source authority.
    }
  }
  await ensureCurrentProjectIndexerParserExecution(input);
  manifest = await readIndexerParserRuntimeIndexManifest(input);
  const metadata = await readIndexerParserRuntimeSourceMetadata({ ...input, manifest, counters });
  return metadata.source_binding.source_identity_inventory;
}
