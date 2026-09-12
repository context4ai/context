import { approvedKnowledgeMapTargets, knowledgeMapCoverage } from "./knowledgeMapCoverage.js";
import { acceptStructureDecision, readKnowledgeMap } from "./knowledgeMap.js";
import { withProjectWriteLock } from "./writeLock.js";
import type { KnowledgeMap, KnowledgeMapUpdate } from "@c4a/context";
import { deliveryWaveSize, readDeliveryCadence } from "./indexerDeliveryCadence.js";
import { authorStreamRecord, PARTITION_STREAM_PATH, partitionAuthorBinding, partitionStreamRecord, readPartitionStream, reopenPartitionStream } from "./indexerPartitionStream.js";

import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  buildIndexerAuthorizedWorksetViewSource,
  buildIndexerMainWorksetSet,
  invalidateIndexerMainRunWorksets,
  canonicalIndexerJson,
  indexerArtifactRef,
  indexerArticleSectionKey,
  indexerPartitionGroupRef,
  indexerProtocolDigest,
  validateIndexerPartitionSemanticInput,
  validateIndexerPartitionInputs,
  type IndexerAuthorizedWorksetViewSource,
  type IndexerPartitionSemanticInput,
  type IndexerPartitionPlan,
  type IndexerPartitionValidationInput,
  type IndexerMainPartitionWorkset,
  type IndexerArticlePlan,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import {
  buildProjectIndexerMainAuthorWorksets,
} from "./indexerMainLifecycleActions.js";
import {
  INDEXER_MAIN_RUN_STORE_ROOT,
  prepareIndexerMainRunStore,
  readAcceptedIndexerMainPartitionResultRecords,
} from "./indexerMainRunStore.js";
import {
  currentLedger,
  readJsonMaybe,
  normalizeRunSpec,
  acceptedCachePath, currentSpec, persistLedger,
} from "./indexerMainRunStoreRecords.js";
import type { IndexerConsumerWorksetProjection } from "./indexerConsumerWorksetPlanner.js";
import { prepareAndStartNextIndexerBatch } from "./indexerCurrentBatch.js";
import { summarizeIndexerObsoleteScope } from "./indexerObsoleteScope.js";
import { excludeIndexerPartitionMembers } from "./indexerPartitionScope.js";
import { preparePartitionStage } from "./indexerPartitionStage.js";

const STRUCTURE_ROOT = join(".tmp", "context-runtime", "indexer", "structure-review");
const DECISION_PATH = join(STRUCTURE_ROOT, "current.json");
const PLAN_PATH = join(STRUCTURE_ROOT, "author-plan.json");
const FEEDBACK_PATH = join(STRUCTURE_ROOT, "feedback.json");

type ObsoleteScope = ReturnType<typeof summarizeIndexerObsoleteScope>;
type ReadableObsoleteScope = Omit<ObsoleteScope, "affected"> & {
  affected: Array<Omit<ObsoleteScope["affected"][number], "member_ids">>;
};

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
    scope_change?: { removed_member_ids: string[] };
    outline: string[];
    articles?: IndexerArticlePlan[];
    article_targets?: Array<{ article_key: string; artifact_ref: string; section_keys: string[] }>;
    members: string[];
    questions: string[];
  }>;
  excluded: Array<{ item: string; reason_code: string }>;
  unsupported: Array<{ item: string; missing_capabilities: string[] }>;
  obsolete_scope?: ReadableObsoleteScope;
  preview_digest: string;
}

export interface CurrentIndexerStructureReview {
  knowledge_map?: KnowledgeMap | null;
  preview: IndexerSemanticStructurePreview;
  revision: string;
  approved: boolean;
}

interface PreparedIndexerStructurePlan {
  revision: string;
  preview: IndexerSemanticStructurePreview;
  workset_set: unknown;
  run_specs: unknown[];
  obsolete_member_ids?: string[];
  partition_request_digests?: string[];
  final_wave?: boolean;
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
    ...(candidate.final_wave === undefined ? {} : { final_wave: candidate.final_wave }),
    revision: candidate.revision,
    preview: candidate.preview,
    workset_set: candidate.workset_set,
    run_specs: candidate.run_specs,
    ...(candidate.obsolete_member_ids === undefined ? {} : { obsolete_member_ids: candidate.obsolete_member_ids }),
    ...(candidate.partition_request_digests === undefined ? {} : { partition_request_digests: candidate.partition_request_digests }),
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

/** The planning inputs include Indexers that legitimately produced no pages.
 * Keep their original requests when checking the later Author stage's scope. */
export async function readStructurePartitionRequestDigests(projectRoot: string): Promise<string[] | undefined> {
  return (await readPreparedPlan(projectRoot))?.partition_request_digests;
}

export async function hasApprovedEmptyIndexerStructure(projectRoot: string): Promise<boolean> {
  const structure = await currentIndexerStructureReview(projectRoot);
  return structure?.approved === true && structure.preview.topics.length === 0;
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
    knowledge_map: await readKnowledgeMap(projectRoot) ?? null,
    revision: stored.revision,
    approved: await reviewDecision(projectRoot, stored.revision),
  };
}

export async function prepareCurrentIndexerStructurePlan(
  projectRoot: string,
  allowPending = false,
): Promise<CurrentIndexerStructureReview> {
  const ledger = await currentLedger(projectRoot);
  if (
    ledger === undefined ||
    ledger.entries.some((entry) => entry.stage !== "partition") ||
    ledger.entries.length === 0 ||
    (!allowPending && ledger.entries.some((entry) => entry.state !== "accepted")) ||
    ledger.entries.some((entry) => entry.state === "running")
  ) {
    throw new TypeError("semantic structure preparation requires accepted Partition results");
  }
  const records = await readAcceptedIndexerMainPartitionResultRecords(projectRoot, allowPending);
  const semantic = await Promise.all(records.map((record) =>
    readSemanticPartition(projectRoot, record.request.execution_request_digest)
  ));
  if (semantic.some((entry) => entry !== undefined && entry.outcome !== "complete")) {
    throw new TypeError("failed partition cannot enter structure review");
  }
  const scopeFeedback = await readJsonMaybe(projectRoot, FEEDBACK_PATH) as
    { excluded_member_ids?: string[] } | undefined;
  const excluded = new Set(scopeFeedback?.excluded_member_ids ?? []);
  const partitions = excludeIndexerPartitionMembers(records.map((record): IndexerPartitionValidationInput => {
    if (record.request.workset.stage !== "partition") {
      throw new TypeError("semantic structure requires Partition worksets");
    }
    return {
      plan: record.artifact_result as IndexerPartitionPlan,
      workset: record.request.workset,
      canonical_inventory_members: record.validation.canonical_inventory_members as
        IndexerPartitionValidationInput["canonical_inventory_members"],
      authorized_source_refs: record.validation.authorized_source_refs as
        IndexerPartitionValidationInput["authorized_source_refs"],
      authorized_strategies: record.validation.authorized_strategies as
        IndexerPartitionValidationInput["authorized_strategies"],
      ...(record.validation.required_question_target_refs === undefined
        ? {}
        : {
            required_question_target_refs:
              record.validation.required_question_target_refs as string[],
          }),
    };
  }), excluded);
  const validated = validateIndexerPartitionInputs(partitions);
  const currentPartitions = partitions.map((partition, index) => ({ ...partition, plan: validated[index]!.plan }));
  const origins = new Map(currentPartitions.flatMap(partition => {
    const plan = partition.plan as IndexerPartitionPlan;
    return plan.groups.map(group => {
      const origin = { partition_workset_digest: partition.workset.workset_digest, group_key: group.group_key };
      return [indexerPartitionGroupRef(origin), [origin]] as const;
    });
  }));
  const prepared = await prepareAuthorPlan(
    projectRoot,
    currentPartitions,
    partitions,
    origins,
    new Map(records.flatMap((record) => record.validation.partition_projection === undefined
      ? []
      : [[record.request.workset.workset_digest,
          record.validation.partition_projection as IndexerConsumerWorksetProjection] as const])),
  );
  const stream = await readPartitionStream(projectRoot);
  const completed = new Set(stream?.completed_bindings ?? []);
  const allPlanned = ledger.entries.every(entry => entry.state === "accepted");
  const available = prepared.author.run_specs.filter(spec =>
    !completed.has(partitionAuthorBinding(spec)) && (allPlanned ||
      (spec.validation.page_plan as { ready_for_author?: boolean } | undefined)?.ready_for_author === true))
    .sort((left, right) => {
      const priority = (spec: typeof left) => (spec.validation.page_plan as { priority?: number } | undefined)?.priority ?? Number.MAX_SAFE_INTEGER;
      return priority(left) - priority(right) || left.request.workset.workset_digest.localeCompare(right.request.workset.workset_digest);
    });
  const target = deliveryWaveSize(await readDeliveryCadence(projectRoot),
    allPlanned ? prepared.author.run_specs.length : undefined);
  const selected = !allPlanned && available.length < target
    ? [] : available.slice(0, target);
  const selectedKeys = new Set(selected.flatMap(spec => spec.request.workset.stage === "author"
    ? [spec.request.workset.logical_unit_ref] : []));
  prepared.author.obsolete_scope = summarizeIndexerObsoleteScope(selected, {
    pending_planning: !allPlanned,
    deprecated_member_ids: new Set(prepared.author.obsolete_scope.affected.flatMap(item => item.member_ids)),
    titles: new Map(currentPartitions.flatMap(partition => partition.plan.status === "complete"
      ? partition.plan.groups.map(group => [group.group_key, group.label] as const) : [])),
  });
  prepared.author.run_specs = selected;
  prepared.author.workset_set = buildIndexerMainWorksetSet(selected.map(spec => spec.request.workset));
  const authoredByOrigin = new Map(records.flatMap((partition, entryIndex) => {
    const result = semantic[entryIndex];
    return result?.outcome === "complete"
      ? result.groups.map((group) => [
          `${partition.request.workset.workset_digest}\u0000${group.key}`,
          group,
        ] as const)
      : [];
  }));
  const payload = {
    protocol: "context.indexer.semantic-structure-preview/v1" as const,
    obsolete_scope: {
      ...prepared.author.obsolete_scope,
      affected: prepared.author.obsolete_scope.affected.map((item) => ({
        title: item.title, paths: item.paths, mixed_current_content: item.mixed_current_content,
      })),
    },
    topics: partitions.flatMap((partition) => {
      const plan = partition.plan as IndexerPartitionPlan;
      return plan.status === "complete" ? plan.groups.filter(group => selectedKeys.has(group.logical_unit_ref)).map((group) => {
        const groupRef = indexerPartitionGroupRef({
          partition_workset_digest: partition.workset.workset_digest,
          group_key: group.group_key,
        });
        const owner = origins.get(groupRef)?.[0];
        const authored = owner === undefined ? undefined : authoredByOrigin.get(
          `${owner.partition_workset_digest}\u0000${owner.group_key}`,
        );
        return {
          key: group.group_key,
          ...(group.scope_change === undefined ? {} : { scope_change: group.scope_change }),
          title: authored?.title ?? group.label,
          reader_task: authored?.reader_task ?? `Browse ${group.label}.`,
          outline: authored?.outline ?? [group.label],
          ...(group.articles === undefined ? {} : { articles: group.articles,
            article_targets: group.articles.map(article => ({ article_key: article.key,
              artifact_ref: indexerArtifactRef(group.logical_unit_ref, {
                artifact_id: article.key, artifact_kind: article.artifact_intent.split("/").at(-1)!,
              }), section_keys: article.sections.map(section => indexerArticleSectionKey(article.key, section.key)) })) }),
          members: group.member_ids,
          questions: group.reader_question_refs,
        };
      }) : [];
    }).sort((left, right) => left.key.localeCompare(right.key)),
    excluded: [...excluded].map((item) => ({ item, reason_code: "user-excluded-obsolete" })).concat(records.flatMap((partition, entryIndex) => {
      const authored = semantic[entryIndex];
      if (authored !== undefined) return authored.excluded;
      const plan = partition.artifact_result as IndexerPartitionPlan;
      return plan.member_dispositions.flatMap((item) =>
        item.inventory_disposition === "excluded-with-reason"
          ? [{ item: item.member_id, reason_code: item.reason_code }]
          : []
      );
    }).filter((item) => !excluded.has(item.item)))
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
    final_wave: allPlanned && selected.length === available.length,
    revision,
    preview,
    workset_set: prepared.author.workset_set,
    run_specs: prepared.author.run_specs,
    obsolete_member_ids: [...new Set(prepared.author.obsolete_scope.affected.flatMap((item) => item.member_ids))].sort(),
    partition_request_digests: [...new Map(ledger.entries.map((entry) => [
      entry.indexer_id, entry.execution_request_digest,
    ])).values()].sort(),
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
  const existing = await readJsonMaybe(input.projectRoot, join(STRUCTURE_ROOT, "preview.json"));
  const projection = { ...current.preview, knowledge_map: current.knowledge_map ?? null,
    knowledge_map_coverage: knowledgeMapCoverage(current.knowledge_map ?? undefined, [...await approvedKnowledgeMapTargets(input.projectRoot), ...current.preview.topics.flatMap(topic => topic.article_targets ?? [])]),
    knowledge_map_guidance: "knowledge_map is required on approval. Every approved or current article must have a target binding. Category-only nodes and empty updates do not cover articles. Carry agreed reader organization into knowledge_map.upsert/remove on approval. Use expected_revision from knowledge_map (null for a new workspace). Preserve entries from other waves. Bind targets to article_targets artifact_ref and optional section_keys; pending targets are not published links. This is organization, not source ownership or evidence." };
  if (JSON.stringify(existing) !== JSON.stringify(projection)) {
    await atomicWriteFile(path, `${JSON.stringify(projection, null, 2)}\n`);
  }
  return { path, digest: indexerProtocolDigest(projection) };
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
    required_question_target_refs?: unknown;
  }>,
  sourcePartitions: readonly IndexerPartitionValidationInput[],
  originsByGroupRef: ReadonlyMap<string, readonly {
    partition_workset_digest: string;
    group_key: string;
  }[]>,
  sourceProjections: ReadonlyMap<string, IndexerConsumerWorksetProjection>,
) {
  const author = await buildProjectIndexerMainAuthorWorksets({
    projectRoot,
    source_partitions: sourcePartitions,
    source_projections: sourceProjections,
    origins_by_group_ref: originsByGroupRef,
    value: {
      protocol: "context.indexer.main-author-workset-build-input/v1",
      partitions,
    },
  });
  if (!("worksets" in author)) {
    throw new TypeError("semantic structure cannot produce author worksets");
  }
  return { author };
}

export async function prepareCurrentIndexerAuthorStage(projectRoot: string): Promise<void> {
  const plan = await readPreparedPlan(projectRoot);
  if (plan === undefined) {
    throw new TypeError("semantic structure Author plan is missing or stale");
  }
  // With no reader pages there is no Author stage. Retain the accepted
  // Partition ledger so the empty structure still has a reviewable authority.
  if (plan.run_specs.length === 0) return;
  const ledger = await currentLedger(projectRoot);
  const streaming = ledger?.entries.every(entry => entry.stage === "partition");
  const stream = streaming ? await authorStreamRecord(projectRoot, plan.run_specs.map(value => partitionAuthorBinding(normalizeRunSpec(value))), plan.final_wave) : undefined;
  await prepareIndexerMainRunStore({
    projectRoot,
    ...(stream === undefined ? {} : { mutable_records: [{ path: PARTITION_STREAM_PATH, value: stream }] }),
    workset_set: plan.workset_set,
    run_specs: plan.run_specs,
  });
}

type StructureReviewCompletion = {
  projectRoot: string;
  revision: string;
  decision: "approved" | "exclude-obsolete" | "request-adjustment";
  feedback?: string;
  knowledge_map?: KnowledgeMapUpdate;
};
export async function completeCurrentIndexerStructureReview(input: StructureReviewCompletion): Promise<"author" | "partition"> {
  return withProjectWriteLock(input.projectRoot, "complete-indexer-structure-review", () => completeStructureReviewUnlocked(input));
}
async function completeStructureReviewUnlocked(input: StructureReviewCompletion): Promise<"author" | "partition"> {
  let current = await currentIndexerStructureReview(input.projectRoot);
  if (current === undefined || current.revision !== input.revision) {
    throw new TypeError("semantic structure review revision is stale");
  }
  if (input.decision === "exclude-obsolete") {
    const scope = current.preview.obsolete_scope;
    if (scope === undefined || scope.exclusion_leaves_no_current_pages) {
      throw new TypeError("obsolete scope exclusion has no remaining current pages; choose a different scope");
    }
    // A no-op exclusion is approval of the current plan. Never replace the
    // accepted Partition ledger with a newly prepared (possibly older) one.
    if (scope.affected_page_count === 0) {
      return completeCurrentIndexerStructureReview({ ...input, decision: "approved" });
    }
    const prior = await readJsonMaybe(input.projectRoot, FEEDBACK_PATH) as
      { excluded_member_ids?: string[] } | undefined;
    const prepared = await readPreparedPlan(input.projectRoot);
    const obsoleteMembers = prepared?.obsolete_member_ids;
    if (obsoleteMembers === undefined) {
      // Older previews contain readable paths only. Rebuild from the accepted
      // cache to resolve identities, rather than guessing from page names.
      const ledger = await preparePartitionStage(input.projectRoot);
      if (ledger?.entries.some((entry) => entry.state !== "accepted")) return "partition";
      const refreshed = await prepareCurrentIndexerStructurePlan(input.projectRoot);
      return completeCurrentIndexerStructureReview({ ...input, revision: refreshed.revision });
    }
    await atomicWriteFile(join(input.projectRoot, FEEDBACK_PATH), canonicalIndexerJson({
      excluded_member_ids: [...new Set([
        ...(prior?.excluded_member_ids ?? []),
        ...obsoleteMembers,
      ])].sort(),
    }));
    // Switching ledgers reuses accepted Partition records. Only the derived
    // Author plan changes; no captured sources or accepted cache is deleted.
    const ledgerBeforeExclusion = await currentLedger(input.projectRoot);
    const partitionLedger = ledgerBeforeExclusion?.entries.every((entry) => entry.stage === "partition" && entry.state === "accepted")
      ? ledgerBeforeExclusion : await preparePartitionStage(input.projectRoot);
    if (partitionLedger?.entries.some((entry) => entry.state !== "accepted")) {
      return "partition";
    }
    current = await prepareCurrentIndexerStructurePlan(input.projectRoot);
  }
  if (input.decision === "approved" || input.decision === "exclude-obsolete") {
    await acceptStructureDecision({ projectRoot: input.projectRoot, decisionPath: DECISION_PATH, revision: current.revision,
      article_targets: current.preview.topics.flatMap(topic => topic.article_targets ?? []),
      ...(input.knowledge_map === undefined ? {} : { knowledge_map: input.knowledge_map }) });
    const feedback = await readJsonMaybe(input.projectRoot, FEEDBACK_PATH) as
      { excluded_member_ids?: string[] } | undefined;
    if (feedback?.excluded_member_ids === undefined) {
      await rm(join(input.projectRoot, FEEDBACK_PATH), { force: true });
    }
    const ledger = await currentLedger(input.projectRoot);
    if (ledger?.entries.every((entry) => entry.stage === "partition") === true) {
      await prepareCurrentIndexerAuthorStage(input.projectRoot);
    }
    // Recovery is auxiliary; inability to save a checkpoint must not block Author.
    try {
      const { saveRecoveryCheckpoint } = await import("./taskRecoveryCheckpoint.js");
      await saveRecoveryCheckpoint(input.projectRoot, current.revision);
    } catch {
      process.stderr.write("[context recovery] Accepted-plan checkpoint unavailable; production can continue. Use task recover if repair is needed.\n");
    }
    const authorLedger = await currentLedger(input.projectRoot);
    const first = authorLedger?.entries.find((entry) =>
      entry.stage === "author" && (entry.state === "pending" || entry.state === "stale")
    );
    if (first !== undefined) {
      await prepareAndStartNextIndexerBatch(input.projectRoot);
    }
    return "author";
  }
  if (input.feedback === undefined) {
    throw new TypeError("structure adjustment requires feedback");
  }
  await rm(join(input.projectRoot, DECISION_PATH), { force: true });
  const feedbackDigest = indexerProtocolDigest({ feedback: input.feedback });
  await atomicWriteFile(join(input.projectRoot, FEEDBACK_PATH), canonicalIndexerJson({
    feedback: input.feedback,
    feedback_digest: feedbackDigest,
  }));
  if (await readPartitionStream(input.projectRoot)) {
    const members = new Set(current.preview.topics.flatMap(topic => topic.members));
    await reopenPartitionStream(input.projectRoot);
    const stream = (await readPartitionStream(input.projectRoot))!;
    const ledger = (await currentLedger(input.projectRoot))!;
    const affected = new Set<string>();
    const deleted: string[] = [];
    for (const entry of ledger.entries) {
      if (entry.state !== "accepted") continue;
      const spec = await currentSpec({ projectRoot: input.projectRoot, request_digest: entry.execution_request_digest });
      const inventory = spec.validation.canonical_inventory_members as Array<{ member_id: string }>;
      if (!inventory.some(member => members.has(member.member_id))) continue;
      affected.add(entry.workset_digest);
      deleted.push(acceptedCachePath(entry.execution_request_digest), semanticResultPath(entry.execution_request_digest));
    }
    const revised = invalidateIndexerMainRunWorksets(ledger, affected);
    const { digest: _digest, ...payload } = stream; void _digest;
    await persistLedger({ projectRoot: input.projectRoot, operation: "prepare", transaction_kind: "adjust-streaming-structure",
      ledger: revised, delete_records: deleted,
      mutable_records: [{ path: PARTITION_STREAM_PATH, value: partitionStreamRecord({ ...payload, partition_ledger: revised }) }] });
    return "partition";
  }
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
