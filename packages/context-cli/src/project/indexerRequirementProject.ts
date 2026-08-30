import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  buildIndexerRequirementInspection,
  buildIndexerRequirementWorksetReport,
  canonicalIndexerJson,
  indexerProtocolDigest,
  indexerRegistryDigests,
  indexerRequirementInspectionInputSchema,
  loadSourcesRegistry,
  parseIndexerRegistry,
  validateIndexerRequirementInspection,
  validateIndexerRequirementWorksetConfirmation,
  validateIndexerRequirementWorksetReport,
  type IndexRequirement,
  type IndexerRequirementInspection,
  type IndexerRequirementWorksetReport,
  type IndexerRegistry,
  type SourcesRegistry,
} from "@c4a/context";
import YAML from "yaml";
import {
  durableContentDigest,
  runDurableSingleFileTransaction,
  type DurableSingleFileTransactionReceipt,
  type DurableTransactionFailureInjector,
} from "./durableSingleFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

interface SourceBoundaryEntry {
  type: "repo" | "file" | "lark";
  id: string;
  name: string;
  revision: string | null;
}

export interface IndexerRequirementApplyReceipt {
  protocol: "context.indexer.requirement-apply-receipt/v1";
  project_ref: string;
  report_digest: string;
  confirmation_digest: string;
  requirement_set_digest: string;
  registry_digest: string;
  indexer_selection_digest: string;
  applied_digest: string;
  stale_propagation: {
    requirement_digest_changed: boolean;
    invalidated_indexer_count: number;
    previous_indexer_selection_digest: string | null;
    reason: "requirement-digest-changed" | "unchanged";
  };
  outcome: "requirements-applied" | "indexer-provider-required";
  transaction: DurableSingleFileTransactionReceipt;
  receipt_digest: string;
}

function sourceBoundaryEntries(registry: SourcesRegistry): SourceBoundaryEntry[] {
  return [
    ...registry.repos.map((source) => ({
      type: "repo" as const,
      id: source.id,
      name: source.name,
      revision: source.ref,
    })),
    ...registry.files.map((source) => ({
      type: "file" as const,
      id: source.id,
      name: source.name,
      revision: source.snapshot?.manifest ?? null,
    })),
    ...registry.larks.map((source) => ({
      type: "lark" as const,
      id: source.id,
      name: source.name,
      revision: source.snapshot?.manifest ?? null,
    })),
  ].sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`));
}

export function indexerRequirementSourceBoundaryDigest(
  registry: SourcesRegistry,
): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.source-boundary/v1",
    sources: sourceBoundaryEntries(registry),
  });
}

function sourceCandidates(
  registry: SourcesRegistry,
  prefix: string,
  identity: string,
): SourceBoundaryEntry[] {
  const entries = sourceBoundaryEntries(registry);
  const allowed = prefix === "docs"
    ? new Set(["file", "lark"])
    : new Set([prefix]);
  return entries.filter((entry) =>
    allowed.has(entry.type) && (entry.id === identity || entry.name === identity || (
      entry.type === "repo" && entry.name.split("/").at(-1) === identity
    ))
  );
}

function canonicalSourceRef(registry: SourcesRegistry, sourceRef: string): string {
  const match = /^(repo|docs|file|lark):(.+)$/u.exec(sourceRef);
  if (match === null || match[2]!.includes("#") || match[2]!.includes("@")) {
    throw new TypeError(
      `requirement source_ref must identify a registered source boundary: ${sourceRef}`,
    );
  }
  const prefix = match[1]!;
  const candidates = sourceCandidates(registry, prefix, match[2]!);
  if (candidates.length === 0) {
    throw new TypeError(`requirement source_ref is not registered: ${sourceRef}`);
  }
  if (candidates.length > 1) {
    throw new TypeError(`requirement source_ref is ambiguous: ${sourceRef}`);
  }
  const source = candidates[0]!;
  return `${prefix}:${source.name}`;
}

function normalizeRequirementSources(
  registry: SourcesRegistry,
  requirement: IndexRequirement,
): IndexRequirement {
  const normalizeTargets = (targets: IndexRequirement["target_scope"]["targets"]) =>
    targets.map((target) => ({
      ...target,
      source_ref: canonicalSourceRef(registry, target.source_ref),
    }));
  return {
    ...requirement,
    target_scope: { targets: normalizeTargets(requirement.target_scope.targets) },
    evidence_source_scope: {
      targets: normalizeTargets(requirement.evidence_source_scope.targets),
    },
    ...(requirement.exclusions === undefined ? {} : {
      exclusions: requirement.exclusions.map((exclusion) => ({
        ...exclusion,
        scope: { targets: normalizeTargets(exclusion.scope.targets) },
      })),
    }),
  };
}

export async function inspectProjectIndexerRequirements(input: {
  projectRoot: string;
  value: unknown;
}): Promise<IndexerRequirementInspection> {
  const parsed = indexerRequirementInspectionInputSchema.parse(input.value);
  const sources = await loadSourcesRegistry({ rootDir: input.projectRoot });
  return buildIndexerRequirementInspection({
    value: {
      ...parsed,
      requirements: parsed.requirements.map((requirement) =>
        normalizeRequirementSources(sources, requirement)),
    },
    source_boundary_digest: indexerRequirementSourceBoundaryDigest(sources),
  });
}

async function readMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function currentIndexerRegistry(input: {
  projectRoot: string;
}): Promise<{ content: string; registry: IndexerRegistry } | null> {
  const content = await readMaybe(join(input.projectRoot, DEFAULT_INDEXER_REGISTRY_PATH));
  return content === undefined
    ? null
    : { content, registry: parseIndexerRegistry(content) };
}

async function assertCurrentSourceBoundary(input: {
  projectRoot: string;
  expectedDigest: string;
}): Promise<void> {
  const sources = await loadSourcesRegistry({ rootDir: input.projectRoot });
  if (indexerRequirementSourceBoundaryDigest(sources) !== input.expectedDigest) {
    throw new TypeError("requirement inspection source boundary is stale");
  }
}

export async function compareProjectIndexerRequirements(input: {
  projectRoot: string;
  inspection: unknown;
}): Promise<IndexerRequirementWorksetReport> {
  const inspection = validateIndexerRequirementInspection(input.inspection);
  await assertCurrentSourceBoundary({
    projectRoot: input.projectRoot,
    expectedDigest: inspection.source_boundary_digest,
  });
  const current = await currentIndexerRegistry({ projectRoot: input.projectRoot });
  return buildIndexerRequirementWorksetReport({
    inspection,
    base_requirement_set: current === null
      ? null
      : {
          protocol: "context.indexer.requirement-set/v1",
          requirements: current.registry.requirements,
        },
  });
}

function validateApplyBindings(input: {
  inspection: IndexerRequirementInspection;
  report: IndexerRequirementWorksetReport;
}): void {
  if (
    input.inspection.project_ref !== input.report.project_ref ||
    input.inspection.requirement_set_digest !== input.report.target_requirement_set_digest ||
    input.inspection.source_boundary_digest !== input.report.source_boundary_digest ||
    canonicalIndexerJson(input.inspection.requirement_set) !==
      canonicalIndexerJson(input.report.target_requirement_set)
  ) {
    throw new TypeError("requirement inspection and comparison report do not identify the same target");
  }
}

function targetRegistry(input: {
  current: IndexerRegistry | null;
  report: IndexerRequirementWorksetReport;
}): { registry: IndexerRegistry; changed: boolean; invalidatedCount: number } {
  const currentDigest = input.current === null
    ? null
    : indexerRegistryDigests(input.current).requirementSetDigest;
  const changed = currentDigest !== input.report.target_requirement_set_digest;
  return {
    registry: {
      protocol: "context.indexer.registry/v1",
      requirements: input.report.target_requirement_set.requirements,
      indexers: changed ? [] : input.current?.indexers ?? [],
    },
    changed,
    invalidatedCount: changed ? input.current?.indexers.length ?? 0 : 0,
  };
}

export async function applyProjectIndexerRequirements(input: {
  projectRoot: string;
  inspection: unknown;
  report: unknown;
  confirmation: unknown;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<IndexerRequirementApplyReceipt> {
  return withProjectWriteLock(input.projectRoot, "apply-index-requirements", async () => {
    const inspection = validateIndexerRequirementInspection(input.inspection);
    const report = validateIndexerRequirementWorksetReport(input.report);
    const confirmation = validateIndexerRequirementWorksetConfirmation({
      report,
      confirmation: input.confirmation,
    });
    validateApplyBindings({ inspection, report });
    await assertCurrentSourceBoundary({
      projectRoot: input.projectRoot,
      expectedDigest: report.source_boundary_digest,
    });

    const current = await currentIndexerRegistry({ projectRoot: input.projectRoot });
    const currentRequirementDigest = current === null
      ? null
      : indexerRegistryDigests(current.registry).requirementSetDigest;
    if (currentRequirementDigest !== report.base_requirement_set_digest) {
      throw new TypeError("requirement apply base CAS is stale");
    }
    const previousSelectionDigest = current === null
      ? null
      : indexerRegistryDigests(current.registry).indexerSelectionDigest;
    const target = targetRegistry({
      current: current?.registry ?? null,
      report,
    });
    const targetContent = YAML.stringify(target.registry);
    const parsedTarget = parseIndexerRegistry(targetContent, "requirement-apply:target");
    const targetDigests = indexerRegistryDigests(parsedTarget);
    const transaction = await runDurableSingleFileTransaction({
      projectRoot: input.projectRoot,
      kind: "apply-index-requirements",
      target_path: DEFAULT_INDEXER_REGISTRY_PATH,
      expected_base_digest: current === null ? null : durableContentDigest(current.content),
      target_content: targetContent,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });

    const appliedContent = await readFile(
      join(input.projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
      "utf8",
    );
    const applied = parseIndexerRegistry(appliedContent);
    const appliedDigests = indexerRegistryDigests(applied);
    if (
      canonicalIndexerJson(applied) !== canonicalIndexerJson(parsedTarget) ||
      appliedDigests.requirementSetDigest !== report.target_requirement_set_digest ||
      appliedDigests.registryDigest !== targetDigests.registryDigest
    ) {
      throw new TypeError("applied requirement registry does not match the confirmed target");
    }
    const appliedDigest = indexerProtocolDigest({
      protocol: "context.indexer.requirement-applied/v1",
      requirement_set_digest: appliedDigests.requirementSetDigest,
      registry_digest: appliedDigests.registryDigest,
      transaction_target_digest: transaction.target_digest,
    });
    const payload: Omit<IndexerRequirementApplyReceipt, "receipt_digest"> = {
      protocol: "context.indexer.requirement-apply-receipt/v1",
      project_ref: report.project_ref,
      report_digest: report.report_digest,
      confirmation_digest: confirmation.confirmation_digest,
      requirement_set_digest: appliedDigests.requirementSetDigest,
      registry_digest: appliedDigests.registryDigest,
      indexer_selection_digest: appliedDigests.indexerSelectionDigest,
      applied_digest: appliedDigest,
      stale_propagation: {
        requirement_digest_changed: target.changed,
        invalidated_indexer_count: target.invalidatedCount,
        previous_indexer_selection_digest: previousSelectionDigest,
        reason: target.changed ? "requirement-digest-changed" : "unchanged",
      },
      outcome: applied.indexers.length === 0
        ? "indexer-provider-required"
        : "requirements-applied",
      transaction,
    };
    return { ...payload, receipt_digest: indexerProtocolDigest(payload) };
  });
}
