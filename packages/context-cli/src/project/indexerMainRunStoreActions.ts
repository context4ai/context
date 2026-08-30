import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateIndexerMainRunRequest,
} from "@c4a/context";
import {
  acceptIndexerMainRunStore,
  convergeIndexerMainPartitionRunStore,
  failIndexerMainRunStore,
  observeIndexerMainRunStore,
  prepareIndexerMainRunStore,
  startIndexerMainRunStore,
} from "./indexerMainRunStore.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function protocol(value: Record<string, unknown>, expected: string): void {
  if (value.protocol !== expected) {
    throw new TypeError(`main run store input.protocol must be ${expected}`);
  }
}

export async function assertCurrentIndexerRequirement(
  projectRoot: string,
  requirementSetDigest: unknown,
): Promise<Set<string>> {
  const registry = parseIndexerRegistry(await readFile(
    join(projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  if (
    typeof requirementSetDigest !== "string" ||
    requirementSetDigest !== indexerRegistryDigests(registry).requirementSetDigest
  ) {
    throw new TypeError("main run store input targets a stale requirement set");
  }
  return new Set(registry.requirements.map((item) => `requirement:${item.id}`));
}

export async function prepareProjectIndexerMainRunStore(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "main run store preparation input");
  protocol(value, "context.indexer.main-run-ledger-prepare-input/v1");
  const allowedRequirements = await assertCurrentIndexerRequirement(
    input.projectRoot,
    value.requirement_set_digest,
  );
  if (!Array.isArray(value.run_specs)) {
    throw new TypeError("main run store preparation requires run_specs");
  }
  for (const candidate of value.run_specs) {
    const spec = record(candidate, "main run spec");
    const request = validateIndexerMainRunRequest(spec.request);
    if (!allowedRequirements.has(request.workset.requirement_ref)) {
      throw new TypeError("main run store references an unknown requirement");
    }
    if (request.workset.requirement_set_digest !== value.requirement_set_digest) {
      throw new TypeError("main run store spec targets a stale requirement set");
    }
  }
  const result = await prepareIndexerMainRunStore({
    projectRoot: input.projectRoot,
    workset_set: value.workset_set,
    run_specs: value.run_specs,
  });
  return {
    protocol: "context.indexer.main-run-ledger-preparation/v1" as const,
    ...result,
  };
}

export async function startProjectIndexerMainRunStore(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "main run store start input");
  protocol(value, "context.indexer.main-run-store-start-input/v1");
  await assertCurrentIndexerRequirement(input.projectRoot, value.requirement_set_digest);
  return {
    protocol: "context.indexer.main-run-store-start/v1" as const,
    ...await startIndexerMainRunStore({
      projectRoot: input.projectRoot,
      workset_digest: String(value.workset_digest ?? ""),
    }),
  };
}

export async function acceptProjectIndexerMainRunStore(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "main run store acceptance input");
  protocol(value, "context.indexer.main-run-store-accept-input/v1");
  await assertCurrentIndexerRequirement(input.projectRoot, value.requirement_set_digest);
  if (!Array.isArray(value.workset_read_receipts)) {
    throw new TypeError("main run store acceptance requires workset_read_receipts");
  }
  return {
    protocol: "context.indexer.main-run-store-acceptance/v1" as const,
    ...await acceptIndexerMainRunStore({
      projectRoot: input.projectRoot,
      workset_digest: String(value.workset_digest ?? ""),
      result: value.result,
      workset_read_receipts: value.workset_read_receipts,
    }),
  };
}

export async function convergeProjectIndexerMainPartitionRunStore(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "main partition convergence input");
  protocol(value, "context.indexer.main-run-partition-convergence-input/v1");
  await assertCurrentIndexerRequirement(input.projectRoot, value.requirement_set_digest);
  if (!Array.isArray(value.workset_read_receipts)) {
    throw new TypeError("main partition convergence requires workset_read_receipts");
  }
  const result = await convergeIndexerMainPartitionRunStore({
    projectRoot: input.projectRoot,
    workset_digest: String(value.workset_digest ?? ""),
    result: value.result,
    workset_read_receipts: value.workset_read_receipts,
  });
  return {
    protocol: "context.indexer.main-run-partition-convergence/v1" as const,
    ...result,
    outcome: result.convergence.decision,
    graph_outcome: result.convergence.decision === "accepted"
      ? "completed" as const
      : result.convergence.decision === "retry-required"
      ? "partial" as const
      : result.convergence.decision === "catalog-fallback-required"
      ? "blocked" as const
      : "failed" as const,
  };
}

export async function failProjectIndexerMainRunStore(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "main run store failure input");
  protocol(value, "context.indexer.main-run-store-fail-input/v1");
  await assertCurrentIndexerRequirement(input.projectRoot, value.requirement_set_digest);
  return {
    protocol: "context.indexer.main-run-store-failure/v1" as const,
    ...await failIndexerMainRunStore({
      projectRoot: input.projectRoot,
      workset_digest: String(value.workset_digest ?? ""),
      reason_code: String(value.reason_code ?? ""),
      dependency_digests: Array.isArray(value.dependency_digests)
        ? value.dependency_digests.map(String)
        : [],
    }),
  };
}

export async function observeProjectIndexerMainRunStore(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "main run store observation input");
  protocol(value, "context.indexer.main-run-ledger-observation-input/v1");
  await assertCurrentIndexerRequirement(input.projectRoot, value.requirement_set_digest);
  const observed = await observeIndexerMainRunStore(input.projectRoot);
  return observed.status;
}
