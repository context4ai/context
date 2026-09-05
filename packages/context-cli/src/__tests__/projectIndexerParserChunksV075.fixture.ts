import { createHash } from "node:crypto";
import {
  authorizeIndexerDependencies,
  buildIndexerParserCoordinateMapping,
  buildIndexerParserDependencyIntentSet,
  buildIndexerParserResolutionLock,
  indexerParserExecutionEntryDigest,
  indexerProtocolDigest,
} from "@c4a/context";
import { bundledIndexerProfileContract } from "../project/indexerBaseContracts.js";
import { buildProjectIndexerParserExecutionPlan } from "../project/indexerParserExecutionPlanning.js";
import { executeProjectIndexerParserPlan } from "../project/indexerParserRuntimeExecution.js";
import { writeIndexerParserRuntimeIndex } from "../project/indexerParserRuntimeIndex.js";

export async function parserChunkFixture(projectRoot: string, changed = false) {
  const profileContract = bundledIndexerProfileContract();
  const requirement = profileContract.profiles.find((profile) => profile.id === "monorepo-container")!
    .parser_requirements.find((candidate) => candidate.capability === "parser.json")!;
  const mapping = buildIndexerParserCoordinateMapping({
    requirement, resolution: "direct", registry: "npm",
    actual_coordinate: requirement.community_coordinate, abi_digest: requirement.abi_digest,
  });
  const lock = buildIndexerParserResolutionLock({
    requirement, mapping, lock_integrity: "sha512-Y2h1bmstZml4dHVyZQ==",
    resolved_content_digest: indexerProtocolDigest("extract-package"),
  });
  const files = {
    "config/first.json": JSON.stringify({ module: "first", revision: changed ? 2 : 1 }),
    "config/second.json": JSON.stringify({ module: "second", mode: "reader" }),
    "config/third.json": JSON.stringify({ module: "third", mode: "writer" }),
  };
  const sourceRegistryDigest = indexerProtocolDigest(files);
  const source = { source_ref: "repo:chunk-fixture", module_ref: "module:application" };
  const plan = buildProjectIndexerParserExecutionPlan({
    profile_contract: profileContract, profile_id: "monorepo-container",
    source_registry_digest: sourceRegistryDigest, parser_locks: [lock],
    authorized_files: Object.entries(files).map(([normalized_path, content]) => ({
      ...source, normalized_path, content_digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    })),
  });
  const preview = buildIndexerParserDependencyIntentSet({ requirements: [requirement], mappings: [mapping] });
  const parserPackages = [{
    package: lock.actual_coordinate.package, version: lock.actual_coordinate.version,
    lock_integrity: lock.lock_integrity, resolved_digest: lock.resolved_content_digest,
  }];
  const authorization = authorizeIndexerDependencies({
    dependencies: preview, resolutions: parserPackages,
    authority_ref: "authority:fixture-installer", authority_scope_digest: indexerProtocolDigest("fixture"),
  });
  const execution = await executeProjectIndexerParserPlan({
    projectRoot, profile_contract: profileContract, profile_id: "monorepo-container", execution_plan: plan,
    dependencies: buildIndexerParserDependencyIntentSet({
      requirements: [requirement], mappings: [mapping], authorization_receipt: authorization.receipt,
    }),
    mappings: [mapping], locks: [lock], entry_inputs: plan.entries.map((entry) => ({
      entry_digest: indexerParserExecutionEntryDigest(entry), files,
    })),
  });
  const manifest = await writeIndexerParserRuntimeIndex({
    projectRoot, indexer_id: "chunk-fixture", indexer_digest: indexerProtocolDigest("indexer"),
    source_registry_digest: sourceRegistryDigest, parser_packages: parserPackages,
    parser_package_set_digest: indexerProtocolDigest(parserPackages), execution,
  });
  return { projectRoot, indexer_id: "chunk-fixture", manifest, execution, ...source };
}
