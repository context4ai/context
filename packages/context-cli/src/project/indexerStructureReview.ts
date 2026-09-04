import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  buildIndexerAuthorizedWorksetViewSource,
  canonicalIndexerJson,
  indexerPartitionGroupRef,
  indexerProtocolDigest,
  validateIndexerPartitionSemanticInput,
  type IndexerAuthorizedWorksetViewSource,
  type IndexerPartitionSemanticInput,
  type IndexerPartitionPlan,
  type IndexerMainPartitionWorkset,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import {
  buildProjectIndexerMainAuthorWorksets,
  buildProjectIndexerSubjectCatalog,
  buildProjectIndexerTargetResolutionViews,
} from "./indexerMainLifecycleActions.js";
import {
  INDEXER_MAIN_RUN_STORE_ROOT,
  prepareIndexerMainRunStore,
  readAcceptedIndexerMainPartitionResultRecords,
  startIndexerMainRunStore,
} from "./indexerMainRunStore.js";
import {
  currentLedger,
  readJsonMaybe,
} from "./indexerMainRunStoreRecords.js";
import type { ProjectIndexerTargetResolutionViewBinding } from
  "./indexerCurrentAuthorPreparation.js";

const STRUCTURE_ROOT = join(".tmp", "context-runtime", "indexer", "structure-review");
const DECISION_PATH = join(STRUCTURE_ROOT, "current.json");
const PLAN_PATH = join(STRUCTURE_ROOT, "author-plan.json");
const FEEDBACK_PATH = join(STRUCTURE_ROOT, "feedback.json");

function record(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function semanticResultPath(requestDigest: string): string {
  return join(
    ".tmp",
    "context-runtime",
    "indexer",
    "semantic-results",
    `${requestDigest.slice("sha256:".length)}.json`,
  );
}

export interface IndexerSemanticStructurePreview {
  protocol: "context.indexer.semantic-structure-preview/v1";
  topics: Array<{
    key: string;
    title: string;
    reader_task: string;
    outline: string[];
    members: string[];
    questions: string[];
    target: {
      mode: "create" | "enrich";
      node_ref: string | null;
    };
  }>;
  excluded: Array<{ item: string; reason_code: string }>;
  unsupported: Array<{ item: string; missing_capabilities: string[] }>;
  preview_digest: string;
}

export interface CurrentIndexerStructureReview {
  preview: IndexerSemanticStructurePreview;
  revision: string;
  approved: boolean;
}

interface PreparedIndexerStructurePlan {
  revision: string;
  preview: IndexerSemanticStructurePreview;
  workset_set: unknown;
  run_specs: unknown[];
  plan_digest: string;
}

async function readSemanticPartition(
  projectRoot: string,
  requestDigest: string,
): Promise<IndexerPartitionSemanticInput | undefined> {
  const value = await readJsonMaybe(projectRoot, semanticResultPath(requestDigest));
  if (value === undefined) return undefined;
  return validateIndexerPartitionSemanticInput(value);
}

function preparedPlan(value: unknown): PreparedIndexerStructurePlan | undefined {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = record(value);
  if (
    typeof candidate.revision !== "string" ||
    typeof candidate.plan_digest !== "string" ||
    candidate.preview === undefined ||
    candidate.workset_set === undefined ||
    !Array.isArray(candidate.run_specs)
  ) return undefined;
  const payload = {
    revision: candidate.revision,
    preview: candidate.preview,
    workset_set: candidate.workset_set,
    run_specs: candidate.run_specs,
  };
  if (indexerProtocolDigest(payload) !== candidate.plan_digest) {
    throw new TypeError("prepared semantic structure plan failed integrity validation");
  }
  return candidate as unknown as PreparedIndexerStructurePlan;
}

async function readPreparedPlan(
  projectRoot: string,
): Promise<PreparedIndexerStructurePlan | undefined> {
  return preparedPlan(await readJsonMaybe(projectRoot, PLAN_PATH));
}

async function reviewDecision(projectRoot: string, revision: string): Promise<boolean> {
  const decision = await readJsonMaybe(projectRoot, DECISION_PATH);
  return decision !== undefined && decision !== null &&
    typeof decision === "object" && !Array.isArray(decision) &&
    record(decision).revision === revision && record(decision).decision === "approved";
}

export async function currentIndexerStructureReview(
  projectRoot: string,
): Promise<CurrentIndexerStructureReview | undefined> {
  const stored = await readPreparedPlan(projectRoot);
  if (stored === undefined) return undefined;
  const ledger = await currentLedger(projectRoot);
  const planIsCurrent = ledger !== undefined && ledger.entries.length > 0 && (
    ledger.entries.every((entry) => entry.stage === "author") ||
    ledger.entries.every((entry) => entry.stage === "partition" && entry.state === "accepted")
  );
  if (!planIsCurrent) return undefined;
  return {
    preview: stored.preview,
    revision: stored.revision,
    approved: await reviewDecision(projectRoot, stored.revision),
  };
}

export async function prepareCurrentIndexerStructurePlan(
  projectRoot: string,
): Promise<CurrentIndexerStructureReview> {
  const ledger = await currentLedger(projectRoot);
  if (
    ledger === undefined ||
    ledger.entries.some((entry) => entry.stage !== "partition") ||
    ledger.entries.length === 0 ||
    ledger.entries.some((entry) => entry.state !== "accepted")
  ) {
    throw new TypeError("semantic structure preparation requires accepted Partition results");
  }
  const records = await readAcceptedIndexerMainPartitionResultRecords(projectRoot);
  const semantic = await Promise.all(records.map((record) =>
    readSemanticPartition(projectRoot, record.request.execution_request_digest)
  ));
  if (semantic.some((entry) => entry !== undefined && entry.outcome !== "complete")) {
    throw new TypeError("failed partition cannot enter structure review");
  }
  const partitions = records.map((record) => {
    if (record.request.workset.stage !== "partition") {
      throw new TypeError("semantic structure requires Partition worksets");
    }
    return {
      plan: record.artifact_result as IndexerPartitionPlan,
      workset: record.request.workset,
      canonical_inventory_members: record.validation.canonical_inventory_members,
      authorized_source_refs: record.validation.authorized_source_refs,
      authorized_strategies: record.validation.authorized_strategies,
      required_question_target_refs: record.validation.required_question_target_refs,
    };
  });
  const prepared = await prepareAuthorPlan(projectRoot, partitions);
  const targetByGroup = new Map(prepared.targets.map((target) => [target.group_ref, target]));
  const payload = {
    protocol: "context.indexer.semantic-structure-preview/v1" as const,
    topics: records.flatMap((partition, entryIndex) => {
      const plan = partition.artifact_result as IndexerPartitionPlan;
      const semanticEntry = semantic[entryIndex];
      return plan.status === "complete" ? plan.groups.map((group) => {
        const authored = semanticEntry?.outcome === "complete"
          ? semanticEntry.groups.find((item) => item.key === group.group_key)
          : undefined;
        const groupRef = indexerPartitionGroupRef({
          partition_workset_digest: partition.request.workset.workset_digest,
          group_key: group.group_key,
        });
        const target = targetByGroup.get(groupRef);
        if (target === undefined) {
          throw new TypeError(`semantic structure target is missing for ${groupRef}`);
        }
        return {
          key: group.group_key,
          title: authored?.title ?? group.label,
          reader_task: authored?.reader_task ?? `Browse ${group.label}.`,
          outline: authored?.outline ?? [group.label],
          members: authored?.members ?? group.member_ids,
          questions: authored?.questions ?? group.reader_question_refs,
          target: { mode: target.mode, node_ref: target.node_ref },
        };
      }) : [];
    }).sort((left, right) => left.key.localeCompare(right.key)),
    excluded: records.flatMap((partition, entryIndex) => {
      const authored = semantic[entryIndex];
      if (authored !== undefined) return authored.excluded;
      const plan = partition.artifact_result as IndexerPartitionPlan;
      return plan.member_dispositions.flatMap((item) =>
        item.inventory_disposition === "excluded-with-reason"
          ? [{ item: item.member_id, reason_code: item.reason_code }]
          : []
      );
    })
      .sort((left, right) => left.item.localeCompare(right.item)),
    unsupported: records.flatMap((partition, entryIndex) => {
      const authored = semantic[entryIndex];
      if (authored !== undefined) return authored.unsupported;
      const plan = partition.artifact_result as IndexerPartitionPlan;
      return plan.member_dispositions.flatMap((item) =>
        item.inventory_disposition === "unsupported"
          ? [{ item: item.member_id, missing_capabilities: item.missing_capabilities }]
          : []
      );
    })
      .sort((left, right) => left.item.localeCompare(right.item)),
  };
  const preview: IndexerSemanticStructurePreview = {
    ...payload,
    preview_digest: indexerProtocolDigest(payload),
  };
  const revision = indexerProtocolDigest({
    protocol: "context.indexer.semantic-structure-review-revision/v1",
    preview_digest: preview.preview_digest,
    partition_results: records.map((record) => record.accepted_record.result_digest).sort(),
  });
  const planPayload = {
    revision,
    preview,
    workset_set: prepared.author.workset_set,
    run_specs: prepared.author.run_specs,
  };
  await atomicWriteFile(
    join(projectRoot, PLAN_PATH),
    canonicalIndexerJson({
      ...planPayload,
      plan_digest: indexerProtocolDigest(planPayload),
    }),
  );
  return { preview, revision, approved: await reviewDecision(projectRoot, revision) };
}

export async function materializeCurrentIndexerStructurePreview(input: {
  projectRoot: string;
  expectedRevision: string;
}): Promise<{ path: string; digest: string }> {
  const current = await currentIndexerStructureReview(input.projectRoot);
  if (current === undefined || current.revision !== input.expectedRevision) {
    throw new TypeError("semantic structure preview is stale");
  }
  const path = join(input.projectRoot, STRUCTURE_ROOT, "preview.json");
  await atomicWriteFile(path, `${JSON.stringify(current.preview, null, 2)}\n`);
  return { path, digest: current.preview.preview_digest };
}

export async function readPendingIndexerStructureFeedback(input: {
  projectRoot: string;
  request: Parameters<typeof buildIndexerAuthorizedWorksetViewSource>[0]["request"];
}): Promise<IndexerAuthorizedWorksetViewSource | undefined> {
  const feedback = await readJsonMaybe(input.projectRoot, FEEDBACK_PATH);
  if (feedback === undefined || feedback === null || typeof feedback !== "object" ||
      Array.isArray(feedback)) return undefined;
  const stored = record(feedback);
  if (typeof stored.feedback !== "string" ||
      typeof stored.feedback_digest !== "string") return undefined;
  return buildIndexerAuthorizedWorksetViewSource({
    request: input.request,
    projection_kind: "structure-revision-feedback",
    input_digests: [stored.feedback_digest],
    items: [{
      ref: `revision-feedback:${stored.feedback_digest}`,
      category: "revision-feedback",
      provenance: {
        protocol: "context.indexer.structure-revision-feedback/v1",
        digest: stored.feedback_digest,
      },
      value: { feedback: stored.feedback },
    }],
  });
}

async function prepareAuthorPlan(
  projectRoot: string,
  partitions: Array<{
    plan: IndexerPartitionPlan;
    workset: IndexerMainPartitionWorkset;
    canonical_inventory_members: unknown;
    authorized_source_refs: unknown;
    authorized_strategies: unknown;
    required_question_target_refs: unknown;
  }>,
) {
  const targetResolutionViews: ProjectIndexerTargetResolutionViewBinding[] = [];
  const targets: Array<{
    group_ref: string;
    mode: "create" | "enrich";
    node_ref: string | null;
  }> = [];
  const catalogGroups = new Map<string, typeof partitions>();
  for (const partition of partitions) {
    const key = `${partition.workset.requirement_ref}\u0000${partition.workset.subject_key_schema_digest}`;
    const group = catalogGroups.get(key) ?? [];
    group.push(partition);
    catalogGroups.set(key, group);
  }
  for (const grouped of catalogGroups.values()) {
    const planGroups = grouped.flatMap((partition) =>
      partition.plan.status === "complete"
        ? partition.plan.groups.map((group) => ({ partition, group }))
        : []
    );
    const queries = planGroups.filter(({ group }) =>
      group.subject_intent === "enrich-or-independent"
    ).map(({ partition, group }) => ({
      group_ref: indexerPartitionGroupRef({
        partition_workset_digest: partition.workset.workset_digest,
        group_key: group.group_key,
      }),
      subject_intent: "enrich-or-independent" as const,
      subject_key: group.subject_key,
    }));
    if (queries.length === 0) continue;
    const first = grouped[0]!;
    const catalog = await buildProjectIndexerSubjectCatalog({
      projectRoot,
      value: {
        protocol: "context.indexer.subject-catalog-build-input/v1",
        requirement_ref: first.workset.requirement_ref,
        subject_key_schema_digest: first.workset.subject_key_schema_digest,
        approved_subjects: [],
        partitions: grouped,
      },
    });
    const resolved = await buildProjectIndexerTargetResolutionViews({
      projectRoot,
      value: {
        protocol: "context.indexer.target-resolution-build-input/v1",
        requirement_set_digest: first.workset.requirement_set_digest,
        catalog,
        queries,
      },
    });
    if (!("views" in resolved)) {
      throw new TypeError("semantic structure contains an ambiguous target resolution");
    }
    targetResolutionViews.push(...resolved.views);
    for (const { partition, group } of planGroups) {
      const groupRef = indexerPartitionGroupRef({
        partition_workset_digest: partition.workset.workset_digest,
        group_key: group.group_key,
      });
      if (group.subject_intent === "primary") {
        targets.push({ group_ref: groupRef, mode: "create", node_ref: null });
        continue;
      }
      const view = resolved.views.find((binding) => binding.group_ref === groupRef)?.view;
      const entry = view?.entries[0];
      targets.push({
        group_ref: groupRef,
        mode: entry?.state === "resolved" ? "enrich" : "create",
        node_ref: entry?.state === "resolved" ? entry.node_ref : null,
      });
    }
  }
  for (const { partition, group } of partitions.flatMap((partition) =>
    partition.plan.status === "complete"
      ? partition.plan.groups.map((group) => ({ partition, group }))
      : []
  )) {
    if (group.subject_intent !== "primary") continue;
    const groupRef = indexerPartitionGroupRef({
      partition_workset_digest: partition.workset.workset_digest,
      group_key: group.group_key,
    });
    if (!targets.some((target) => target.group_ref === groupRef)) {
      targets.push({ group_ref: groupRef, mode: "create", node_ref: null });
    }
  }
  const author = await buildProjectIndexerMainAuthorWorksets({
    projectRoot,
    value: {
      protocol: "context.indexer.main-author-workset-build-input/v1",
      partitions,
      target_resolution_views: targetResolutionViews,
    },
  });
  if (!("worksets" in author)) {
    throw new TypeError("semantic structure cannot produce author worksets");
  }
  return { author, targets };
}

export async function prepareCurrentIndexerAuthorStage(projectRoot: string): Promise<void> {
  const plan = await readPreparedPlan(projectRoot);
  if (plan === undefined) {
    throw new TypeError("semantic structure Author plan is missing or stale");
  }
  await prepareIndexerMainRunStore({
    projectRoot,
    workset_set: plan.workset_set,
    run_specs: plan.run_specs,
  });
}

export async function completeCurrentIndexerStructureReview(input: {
  projectRoot: string;
  revision: string;
  decision: "approved" | "request-adjustment";
  feedback?: string;
}): Promise<"author" | "partition"> {
  const current = await currentIndexerStructureReview(input.projectRoot);
  if (current === undefined || current.revision !== input.revision) {
    throw new TypeError("semantic structure review revision is stale");
  }
  if (input.decision === "approved") {
    await atomicWriteFile(join(input.projectRoot, DECISION_PATH), canonicalIndexerJson({
      revision: current.revision,
      decision: "approved",
    }));
    await rm(join(input.projectRoot, FEEDBACK_PATH), { force: true });
    const ledger = await currentLedger(input.projectRoot);
    if (ledger?.entries.every((entry) => entry.stage === "partition") === true) {
      await prepareCurrentIndexerAuthorStage(input.projectRoot);
    }
    const authorLedger = await currentLedger(input.projectRoot);
    const first = authorLedger?.entries.find((entry) =>
      entry.stage === "author" && (entry.state === "pending" || entry.state === "stale")
    );
    if (first !== undefined) {
      await startIndexerMainRunStore({
        projectRoot: input.projectRoot,
        workset_digest: first.workset_digest,
      });
    }
    return "author";
  }
  if (input.feedback === undefined) {
    throw new TypeError("structure adjustment requires feedback");
  }
  const feedbackDigest = indexerProtocolDigest({ feedback: input.feedback });
  await atomicWriteFile(join(input.projectRoot, FEEDBACK_PATH), canonicalIndexerJson({
    feedback: input.feedback,
    feedback_digest: feedbackDigest,
  }));
  await rm(join(input.projectRoot, INDEXER_MAIN_RUN_STORE_ROOT), {
    recursive: true,
    force: true,
  });
  await rm(join(input.projectRoot, ".tmp", "context-runtime", "indexer", "semantic-results"), {
    recursive: true,
    force: true,
  });
  await rm(join(input.projectRoot, DECISION_PATH), { force: true });
  await rm(join(input.projectRoot, PLAN_PATH), { force: true });
  return "partition";
}
