import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  authorizeIndexerDependencies,
  indexerProtocolDigest,
  type IndexerParserCoordinateMapping,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
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
  validateIndexerParserRuntimeExecutionReceipt,
  type IndexerParserRuntimeExecutionReceipt,
} from "./indexerParserRuntimeExecution.js";
import { bundledIndexerProfileContract } from "./indexerBaseContracts.js";
import {
  inspectProjectIndexerParserSourceAuthority,
  materializeProjectIndexerParserFiles,
} from "./indexerParserSourceMaterialization.js";

const CACHE_ROOT = join(LIFECYCLE_ROOT, "indexer-parser-executions");
const inFlight = new Map<string, Promise<IndexerParserRuntimeExecutionReceipt>>();

function cachePath(projectRoot: string, indexerId: string): string {
  const identity = createHash("sha256").update(indexerId).digest("hex");
  return join(projectRoot, CACHE_ROOT, `${identity}.json`);
}

function cacheMetadataPath(projectRoot: string, indexerId: string): string {
  const identity = createHash("sha256").update(indexerId).digest("hex");
  return join(projectRoot, CACHE_ROOT, `${identity}.meta.json`);
}

interface IndexerParserExecutionCacheMetadata {
  indexer_digest: string;
  source_registry_digest: string;
  profile_contract_digest: string;
  execution_plan_digest: string;
  execution_digest: string;
  execution_content_digest: string;
  parser_packages: InstalledIndexerParserPackage[];
  parser_package_set_digest: string;
}

function contentDigest(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parserPackageSetDigest(packages: readonly InstalledIndexerParserPackage[]): string {
  return indexerProtocolDigest([...packages].sort((left, right) =>
    left.package.localeCompare(right.package)
  ));
}

function parseCacheMetadata(value: unknown): IndexerParserExecutionCacheMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("parser execution cache metadata must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const requiredDigests = [
    "indexer_digest",
    "source_registry_digest",
    "profile_contract_digest",
    "execution_plan_digest",
    "execution_digest",
    "execution_content_digest",
    "parser_package_set_digest",
  ] as const;
  for (const field of requiredDigests) {
    if (typeof candidate[field] !== "string") {
      throw new TypeError(`parser execution cache metadata ${field} is invalid`);
    }
  }
  if (!Array.isArray(candidate.parser_packages)) {
    throw new TypeError("parser execution cache metadata parser_packages is invalid");
  }
  return candidate as unknown as IndexerParserExecutionCacheMetadata;
}

async function readCachedExecution(input: {
  projectRoot: string;
  indexer_id: string;
  profile_contract_digest: string;
}): Promise<IndexerParserRuntimeExecutionReceipt | undefined> {
  try {
    const metadata = parseCacheMetadata(JSON.parse(await readFile(
      cacheMetadataPath(input.projectRoot, input.indexer_id),
      "utf8",
    )));
    const authority = await inspectProjectIndexerParserSourceAuthority({
      projectRoot: input.projectRoot,
      indexer_id: input.indexer_id,
    });
    if (
      metadata.indexer_digest !== authority.indexer_digest ||
      metadata.source_registry_digest !== authority.source_registry_digest ||
      metadata.profile_contract_digest !== input.profile_contract_digest
    ) return undefined;
    const currentPackages = await Promise.all(metadata.parser_packages.map((candidate) =>
      inspectInstalledIndexerParserPackage({
        package: candidate.package,
        version: candidate.version,
      })
    ));
    if (
      parserPackageSetDigest(currentPackages) !== metadata.parser_package_set_digest ||
      parserPackageSetDigest(metadata.parser_packages) !== metadata.parser_package_set_digest
    ) return undefined;
    const bytes = await readFile(cachePath(input.projectRoot, input.indexer_id));
    if (contentDigest(bytes) !== metadata.execution_content_digest) return undefined;
    const value = JSON.parse(bytes.toString("utf8")) as IndexerParserRuntimeExecutionReceipt;
    if (
      value.protocol !== "context.indexer.parser-runtime-execution/v1" ||
      value.execution_plan_digest !== metadata.execution_plan_digest ||
      value.profile_contract_digest !== metadata.profile_contract_digest ||
      value.execution_digest !== metadata.execution_digest
    ) return undefined;
    return value;
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return undefined;
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
  const executionText = `${JSON.stringify(execution)}\n`;
  const executionBytes = Buffer.from(executionText);
  await atomicWriteFile(
    cachePath(input.projectRoot, input.indexer_id),
    executionText,
  );
  const parserPackages = [...resolutions].sort((left, right) =>
    left.package.localeCompare(right.package)
  );
  const metadata: IndexerParserExecutionCacheMetadata = {
    indexer_digest: indexerProtocolDigest(materialized.indexer),
    source_registry_digest: plan.source_registry_digest,
    profile_contract_digest: plan.profile_contract_digest,
    execution_plan_digest: plan.plan_digest,
    execution_digest: execution.execution_digest,
    execution_content_digest: contentDigest(executionBytes),
    parser_packages: parserPackages,
    parser_package_set_digest: parserPackageSetDigest(parserPackages),
  };
  await atomicWriteFile(
    cacheMetadataPath(input.projectRoot, input.indexer_id),
    `${JSON.stringify(metadata)}\n`,
  );
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
