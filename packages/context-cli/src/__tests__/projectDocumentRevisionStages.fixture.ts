import { expect } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalIndexerJson,
  indexerAuthorSemanticInputSchema,
  type IndexerInventoryMember,
} from "@c4a/context";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { buildIndexerPartitionRunResultFromSemantic } from
  "../project/indexerSemanticPartitionResult.js";
import { buildIndexerAuthorRunResultFromSemantic } from
  "../project/indexerSemanticAuthorResult.js";
import {
  acceptIndexerMainAuthorRunsStore,
  acceptIndexerMainPartitionRunsStore,
} from "../project/indexerMainRunStore.js";
import type { readCandidateRecords } from "../project/candidateLedger.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";

export async function completePartitionStage(root: string, withPagePlan = false, streaming = false, subject?: string): Promise<void> {
  await advanceCurrentIndexerLifecycle(root);
  while (true) {
    const current = await resolveCurrentIndexerAgentContext(root);
    if (current === undefined || current.descriptor.stage !== "partition") return;
    const runs = [];
    for (const descriptor of current.descriptor.tasks) {
      const task = await loadCurrentIndexerBatchTask({
        projectRoot: root,
        descriptor: current.descriptor,
        taskKey: descriptor.task_key,
      });
      const workset = task.spec.request.workset;
      if (workset.stage !== "partition") throw new Error("expected Partition task");
      const validation = task.spec.validation as {
        canonical_inventory_members: IndexerInventoryMember[];
        authorized_source_refs: string[];
        subject_key_contract: unknown;
        required_question_target_refs?: string[];
      };
      const suffix = workset.workset_digest.slice(-8);
      const semantic = {
        stage: "partition" as const,
        outcome: "complete" as const,
        groups: [{
          key: `fixture-${suffix}`,
          title: `Fixture ${suffix}`,
          ...(streaming ? { ready_for_author: true } : {}),
          reader_task: "Understand the public fixture capability.",
          ...(withPagePlan ? { artifact_intent: "authoritative-source/usage-guide/integrate-capability/content",
            template_id: "component-library-usage-guide", priority: 0, delivery_boundary: true } : {}),
          subject: {
            namespace: workset.partition_subject_key.namespace,
            kind: workset.partition_subject_key.kind,
            local_key: subject ?? `fixture-${suffix}`,
          },
          subject_intent: "primary" as const,
          members: validation.canonical_inventory_members.map((member) => member.member_id),
          questions: [...workset.reader_question_refs],
          question_targets: (validation.required_question_target_refs ?? []).map((target) => ({
            target,
            role: "primary-carrier" as const,
          })),
          outline: ["Overview"],
        }],
        excluded: [],
        unsupported: [],
      };
      runs.push({
        workset_digest: workset.workset_digest,
        semantic,
        execution_request_digest: task.spec.request.execution_request_digest,
        result: buildIndexerPartitionRunResultFromSemantic({
          request: task.spec.request,
          view: task.view,
          semantic,
          validation: { ...validation, partition_unit_type: "semantic-subject" },
        }),
      });
    }
    const converged = await acceptIndexerMainPartitionRunsStore({
      projectRoot: root,
      runs,
    });
    expect(converged.outcomes.every((outcome) => outcome.outcome === "accepted")).toBe(true);
    for (const run of runs) {
      const semanticPath = join(
        root,
        ".tmp/context-runtime/indexer/semantic-results",
        `${run.execution_request_digest.slice("sha256:".length)}.json`,
      );
      await mkdir(join(semanticPath, ".."), { recursive: true });
      await writeFile(semanticPath, canonicalIndexerJson(run.semantic));
    }
    await advanceCurrentIndexerLifecycle(root);
  }
}

export async function completeAuthorStage(
  root: string,
  options: { catalogOnlyFirst?: boolean; revisionSuffix?: string; relatedPage?: string } = {},
): Promise<{ catalogOnlyCount: number }> {
  let catalogOnlyCount = 0;
  while (true) {
    const current = await resolveCurrentIndexerAgentContext(root);
    if (current === undefined || current.descriptor.stage !== "author") {
      return { catalogOnlyCount };
    }
    const runs = [];
    for (const descriptor of current.descriptor.tasks) {
      const task = await loadCurrentIndexerBatchTask({
        projectRoot: root,
        descriptor: current.descriptor,
        taskKey: descriptor.task_key,
      });
      const workset = task.spec.request.workset;
      if (workset.stage !== "author") throw new Error("expected Author task");
      const validation = task.spec.validation as {
      dependency_view: {
        positive_nodes: Array<{ kind: string; evidence_ref?: string }>;
      };
      expected_subject_key: unknown;
      artifact_policy_eligibility: {
        eligible_variants: Array<{ id: string }>;
      };
      page_plan?: { artifact_intent?: string };
      allowed_source_roles: string[];
      allowed_artifact_intents: Array<{
        source_role: string;
        document_kind: string;
        reader_goal: string;
        artifact_kind: string;
      }>;
      canonical_inventory_members: IndexerInventoryMember[];
      allowed_question_targets: Array<{
        question_target_key: string;
        question_ref: string;
      }>;
      };
      const source = validation.dependency_view.positive_nodes.find((node) =>
        node.kind === "source-span" && node.evidence_ref !== undefined
      );
      if (source?.evidence_ref === undefined) throw new Error("fixture Author has no source span");
      const intent = validation.page_plan?.artifact_intent === undefined ? validation.allowed_artifact_intents[0]
        : validation.allowed_artifact_intents.find((intent) => [intent.source_role, intent.document_kind,
          intent.reader_goal, intent.artifact_kind].join("/") === validation.page_plan!.artifact_intent);
      const policy = validation.artifact_policy_eligibility.eligible_variants[0];
      if (intent === undefined || policy === undefined) throw new Error("fixture Author has no output policy");
      const catalogFact = task.view.items.find((item) =>
        item.category === "fact"
      );
      const catalogOnly = options.catalogOnlyFirst === true &&
        catalogOnlyCount === 0 && catalogFact !== undefined;
      if (catalogOnly) catalogOnlyCount++;
      const semantic = {
      stage: "author" as const,
      group_key: workset.group_key,
      outcome: catalogOnly ? "catalog-only" as const : "publish" as const,
      artifact_intent: [
        intent.source_role,
        intent.document_kind,
        intent.reader_goal,
        intent.artifact_kind,
      ].join("/"),
      policy: policy.id,
      target_resolutions: (workset.target_resolution_view?.entries ?? []).map((entry) => ({
        target: entry.query_ref,
        disposition: entry.state === "resolved"
          ? "reuse-existing" as const
          : "create-independent" as const,
      })),
      ...(catalogOnly ? {} : {
        title: `Fixture ${workset.group_key}`,
        summary: "A focused guide to the fixture's public entry point.",
      }),
      sections: catalogOnly ? [] : [{
        key: "overview",
        heading: "Overview",
        markdown: [
          "Use the exported answer constant as the public entry point.",
          options.revisionSuffix,
          ...(options.relatedPage === undefined ? [] : [`[Related API](${options.relatedPage})`]),
        ].filter((value): value is string => value !== undefined).join("\n\n"),
        source_items: [source.evidence_ref],
        facts: [],
        answers: validation.allowed_question_targets.map((target) =>
          target.question_target_key
        ),
      }],
      member_dispositions: validation.canonical_inventory_members.map((member) => ({
        item: member.member_id,
        state: catalogOnly ? "catalog-only" as const : "covered" as const,
        ...(catalogOnly ? {} : { section: "overview" }),
      })),
      material_gaps: [],
      diagnostics: [],
      };
      const result = buildIndexerAuthorRunResultFromSemantic({
          request: task.spec.request,
          view: task.view,
          semantic: indexerAuthorSemanticInputSchema.parse(semantic),
          validation,
        });
      if (catalogOnly) {
        const output = result.result.result;
        if (output.protocol !== "context.indexer.artifact-result/v1") throw new Error("expected Artifact Result");
        expect(output.artifacts).toEqual([]);
        for (const disposition of output.inventory_dispositions.dispositions) {
          if (disposition.inventory_disposition !== "owned" || disposition.projection_disposition !== "catalog-only") {
            throw new Error("expected catalog-only disposition");
          }
          expect(disposition.fact_refs.length).toBeGreaterThan(0);
          for (const ref of disposition.fact_refs) {
            expect(task.view.items.some((item) => item.ref === ref &&
              (ref === disposition.member_id || item.provenance.container_ref === disposition.member_id))).toBe(true);
          }
        }
      }
      runs.push({
        workset_digest: workset.workset_digest,
        result,
      });
    }
    const accepted = await acceptIndexerMainAuthorRunsStore({
      projectRoot: root,
      runs,
    });
    const rejected = accepted.outcomes.filter((outcome) => outcome.outcome !== "accepted");
    if (rejected.length > 0) throw new Error(JSON.stringify(rejected));
    await advanceCurrentIndexerLifecycle(root);
  }
}

export async function approveCandidates(root: string, candidates: Awaited<ReturnType<typeof readCandidateRecords>>): Promise<void> {
  for (const collection of new Set(candidates.map((candidate) => candidate.collection))) {
      const selected = candidates.filter((candidate) => candidate.collection === collection);
      await applyReviewDecisions({ projectRoot: root, payload: {
        collection, scope: { kind: "collection", collection, count: selected.length,
          ids_sha256: candidateIdsHash(selected.map((candidate) => candidate.candidate_id).sort()),
          candidates_sha256: candidateSetHash(selected) },
        decisions: selected.map((candidate) => ({ candidate_id: candidate.candidate_id, status: "approved" as const })),
      } });
    }
}
