import { submittedProgressSlice } from "./indexerProgressScopes.js";
import { assertCurrentIndexerBatchRevision } from "./indexerBatchRevision.js";
import { previewAuthorBatch } from "./indexerAuthorDraft.js";
import { measureContextDebugOperation } from "./debugTrace.js";
import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import type { HostActionResult } from "@c4a/agent-graph";
import {
  indexerAuthorSemanticInputSchema,
  indexerPartitionSemanticInputSchema,
  parseIndexerCurrentActionSubmission,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { collectProjectStatus } from "./status.js";
import { actionWorkflowSummary } from "./actionWorkflowSummary.js";
import {
  assertProjectWorkflowRevision,
} from "./statusCommand.js";
import { findContextProjectRoot } from "./workspace.js";
import {
  resolveCurrentIndexerAgentContext,
  resolveCurrentIndexerWorkflowRoute,
} from "./indexerCurrentWorkflowRoute.js";
import {
  acceptIndexerMainAuthorRunsStore,
  acceptIndexerMainPartitionRunsStore,
} from "./indexerMainRunStore.js";
import { buildIndexerPartitionRunResultFromSemantic } from
  "./indexerSemanticPartitionResult.js";
import { prepareIndexerAuthorSubmission } from "./indexerAuthorSubmission.js";
import { contextWorkflowAuthorities } from "./workflow/workflowFacts.js";
import {
  CONTEXT_WORKFLOW_AUTHORITIES,
  type ContextWorkflowAuthority,
} from "./workflow/workflowTypes.js";
import {
  completeCurrentIndexerStructureReview,
  currentIndexerStructureReview,
} from "./indexerStructureReview.js";
import { advanceCurrentIndexerLifecycle } from "./indexerCurrentLifecycle.js";
import {
  advanceCurrentIndexerFinalization,
  confirmCurrentIndexerLayout,
  readCurrentIndexerFinalization,
} from "./indexerCurrentFinalization.js";
import {
  buildCurrentIndexerProviderSelectionRoute,
  completeCurrentIndexerProviderSelection,
  indexerRegistryNeedsProviderSelection,
  IndexerProviderSelectionError,
} from "./indexerCurrentProviderSetup.js";
import {
  completeCurrentIndexerProviderProgramAuthorization,
  completeCurrentIndexerProviderResolution,
} from "./indexerCurrentProviderContinuation.js";
import { reopenCurrentAuthorWorksets } from "./documentRevision.js";
import {
  loadCurrentIndexerBatchTask,
  type CurrentIndexerBatchDescriptor,
} from "./indexerCurrentBatch.js";
import { currentIndexerProgress } from "./indexerCurrentProgress.js";
import { observeIndexerBatchCompleted } from "./indexerBatchTiming.js";
import {
  persistIndexerSemanticResult,
  schemaFailure,
  type IndexerTaskCompletionOutcome,
} from "./indexerCurrentActionShared.js";
import { completeCurrentIndexerPostAuthorAction } from
  "./indexerCurrentPostAuthorAction.js";
import { prepareIndexerAuthorMaterial } from "./indexerAuthorMaterial.js";
import { applyIndexerAuthorMaterials, type PreparedAuthorMaterial } from "./indexerAuthorMaterialStore.js";

async function advanceAfterBatch(input: {
  projectRoot: string;
  descriptor: CurrentIndexerBatchDescriptor;
  managed: boolean;
  authorities: readonly ContextWorkflowAuthority[];
  committedTaskCount: number;
  inject_next_preparation_failure?: () => void | Promise<void>;
}) {
  if (input.committedTaskCount > 0) {
    await observeIndexerBatchCompleted({
      projectRoot: input.projectRoot,
      descriptor: input.descriptor,
      completedTaskCount: input.committedTaskCount,
    }).catch(() => undefined);
  }
  try {
    await input.inject_next_preparation_failure?.();
    await measureContextDebugOperation({ projectRoot: input.projectRoot, operation: `indexer.completion.${input.descriptor.stage}.advance` }, () => advanceCurrentIndexerLifecycle(input.projectRoot));
    const next = await measureContextDebugOperation({ projectRoot: input.projectRoot, operation: `indexer.completion.${input.descriptor.stage}.route` }, () => resolveCurrentIndexerWorkflowRoute(input));
    if (next !== undefined) {
      return {
        next,
        current_revision: next.revision,
        progress: await currentIndexerProgress({
          projectRoot: input.projectRoot,
          route: next,
        }),
      };
    }
    const status = await measureContextDebugOperation({ projectRoot: input.projectRoot, operation: `indexer.completion.${input.descriptor.stage}.status` }, () => collectProjectStatus(input.projectRoot, {
      managed: input.managed,
      authorities: input.authorities,
    }));
    return {
      next: status.workflow.current ?? null,
      current_revision: status.workflow.revision,
      progress: status.indexerProgress ?? null,
      workflow_summary: await actionWorkflowSummary(input.projectRoot, status.workflow.status),
    };
  } catch (error) {
    return {
      next: null,
      current_revision: null,
      progress: await currentIndexerProgress({ projectRoot: input.projectRoot }),
      next_preparation: {
        outcome: "failed" as const,
        message: `${input.committedTaskCount} task(s) were saved. Do not resubmit committed outcomes. Only preparation of the next step failed: ${error instanceof Error ? error.message : String(error)}. Run the recovery command to continue; stage progress is not workspace completion.`,
        command: `context run${input.managed ? " --managed" : ""} --format json`,
      },
    };
  }
}

export async function completeCurrentIndexerAction(input: {
  cwd: string;
  revision: string;
  value: unknown;
  managed?: boolean;
  authorities?: readonly ContextWorkflowAuthority[];
  inject_next_preparation_failure?: () => void | Promise<void>;
  preview?: boolean;
}) {
  const found = findContextProjectRoot(input.cwd);
  if (found === null) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "complete-current requires a Context project",
      { category: ErrorCategory.WorkspaceNotFound },
    );
  }
  const authorities = contextWorkflowAuthorities({
    managed: input.managed === true,
    ...(input.authorities === undefined ? {} : { authorities: input.authorities }),
  });
  const semantic = parseIndexerCurrentActionSubmission(input.value);
  if (input.preview && semantic.stage !== "approved-revision" && semantic.stage !== "author") throw new TypeError("--preview applies only to current Author or approved-revision Routes; no tasks were submitted");
  if (semantic.stage === "source-update") {
    await assertProjectWorkflowRevision({ cwd: found.projectRoot, expectedRevision: input.revision,
      managed: input.managed === true, authorities });
    const { completeKnowledgeUpdate } = await import("./knowledgeUpdate.js");
    const result = await completeKnowledgeUpdate({ projectRoot: found.projectRoot, revision: input.revision,
      decisions: semantic.decisions, scope_summary: semantic.scope_summary, new_topics: semantic.new_topics });
    return completedRevisionReceipt(found.projectRoot, semantic.stage, result, input.managed === true, authorities);
  }
  if (semantic.stage === "approved-revision") {
    await assertProjectWorkflowRevision({ cwd: found.projectRoot, expectedRevision: input.revision,
      managed: input.managed === true, authorities });
    const { completeApprovedRevision } = await import("./approvedRevision.js");
    const content = "markdown" in semantic ? { markdown: semantic.markdown } : { sections: semantic.sections };
    if (input.preview) return completeApprovedRevision({ projectRoot: found.projectRoot,
      revision: input.revision, ...content, preview: true });
    const candidate = await completeApprovedRevision({ projectRoot: found.projectRoot,
      revision: input.revision, ...content });
    return completedRevisionReceipt(found.projectRoot, semantic.stage,
      { outcome: candidate === undefined ? "unchanged" : "candidate-prepared",
        ...(candidate === undefined ? {} : { candidate_id: candidate.candidate_id }) }, input.managed === true, authorities);
  }
  if (
    semantic.stage === "partition" || semantic.stage === "author" ||
    semantic.stage === "post-author"
  ) {
    await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.revision-check` }, () => assertCurrentIndexerBatchRevision({
      projectRoot: found.projectRoot,
      expectedRevision: input.revision,
      managed: input.managed === true,
      authorities,
    }));
  } else {
    await assertProjectWorkflowRevision({
      cwd: found.projectRoot,
      expectedRevision: input.revision,
      managed: input.managed === true,
      authorities,
    });
  }
  if (semantic.stage === "provider-selection") {
    const loaded = await loadIndexerRegistry(found.projectRoot);
    if (!await indexerRegistryNeedsProviderSelection(found.projectRoot, loaded.registry)) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        "the current Provider selection is already complete",
        { category: ErrorCategory.WorkflowRevisionStale },
      );
    }
    const currentRoute = await buildCurrentIndexerProviderSelectionRoute({
      projectRoot: found.projectRoot,
      registry: loaded.registry,
      authorities,
      managed: input.managed === true,
    });
    if (currentRoute.revision !== input.revision) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        "the current Provider selection changed before completion",
        { category: ErrorCategory.WorkflowRevisionStale },
      );
    }
    const outcome = await completeCurrentIndexerProviderSelection({
      projectRoot: found.projectRoot,
      currentRegistry: loaded.registry,
      semantic,
    }).catch((error: unknown) => {
      if (!(error instanceof IndexerProviderSelectionError)) throw error;
      throw new ContextError(error.code, error.message, {
        ...error.detail,
        revision_advanced: false,
        current_revision: currentRoute.revision,
        next_action: {
          command: currentRoute.commands[0],
          output_schema: currentRoute.action?.output_schema,
          instruction: "Correct the reported selection gaps and resubmit with this revision. Do not repeat capture or Provider discovery; if no available Provider can cover a required capability, explain that gap instead of guessing.",
        },
      });
    });
    if (outcome === "selection-applied") {
      await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.advance` }, () => advanceCurrentIndexerLifecycle(found.projectRoot));
    }
    const status = await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.status` }, () => collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    }));
    return {
      protocol: "context.indexer.current-action-completion/v2" as const,
      stage: semantic.stage,
      outcome,
      workflow: status.workflow,
    };
  }
  if (semantic.stage === "provider-resolution") {
    const outcome = await completeCurrentIndexerProviderResolution({
      projectRoot: found.projectRoot,
      hostResult: semantic.result as unknown as HostActionResult,
      ...(semantic.managed_output === undefined
        ? {}
        : {
            managedOutput: {
              ref: semantic.managed_output.ref,
              digest: semantic.managed_output.digest,
              value: semantic.managed_output.value,
            },
          }),
    });
    if (outcome === "selection-applied") {
      await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.advance` }, () => advanceCurrentIndexerLifecycle(found.projectRoot));
    }
    const status = await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.status` }, () => collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    }));
    return {
      protocol: "context.indexer.current-action-completion/v2" as const,
      stage: semantic.stage,
      outcome,
      workflow: status.workflow,
    };
  }
  if (semantic.stage === "provider-program-authorization") {
    if (
      input.managed === true &&
      !authorities.includes(CONTEXT_WORKFLOW_AUTHORITIES.indexerProgramExecution)
    ) {
      throw new ContextError(
        ExitCode.UserError,
        "managed Provider program authorization requires indexer-program-execution authority",
        { category: ErrorCategory.UserInputInvalid },
      );
    }
    const outcome = await completeCurrentIndexerProviderProgramAuthorization({
      projectRoot: found.projectRoot,
      decision: semantic.decision,
    });
    if (outcome === "selection-applied") {
      await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.advance` }, () => advanceCurrentIndexerLifecycle(found.projectRoot));
    }
    const status = await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.status` }, () => collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    }));
    return {
      protocol: "context.indexer.current-action-completion/v2" as const,
      stage: semantic.stage,
      outcome,
      workflow: status.workflow,
    };
  }
  if (semantic.stage === "layout-confirmation") {
    const current = await readCurrentIndexerFinalization(found.projectRoot);
    if (current?.state !== "layout-confirmation-required" || current.revision !== input.revision) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        "the current layout confirmation is stale",
        { category: ErrorCategory.WorkflowRevisionStale },
      );
    }
    if (semantic.decision === "rejected") {
      if (semantic.feedback === undefined) {
        throw new ContextError(
          ExitCode.UserError,
          "rejecting a layout requires revision feedback",
          { category: ErrorCategory.UserInputInvalid },
        );
      }
      const reopened = await reopenCurrentAuthorWorksets({
        projectRoot: found.projectRoot,
        target_ref: `layout:${current.revision}`,
        instruction: semantic.feedback,
      });
      const status = await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.status` }, () => collectProjectStatus(found.projectRoot, {
        managed: input.managed === true,
        authorities,
      }));
      return {
        protocol: "context.indexer.current-action-completion/v2" as const,
        stage: semantic.stage,
        outcome: "rejected",
        reopened,
        workflow: status.workflow,
      };
    }
    try {
      await confirmCurrentIndexerLayout({
        projectRoot: found.projectRoot,
        revision: input.revision,
        actor_ref: "human:local-user",
        ...(semantic.paths === undefined ? {} : { paths: semantic.paths }),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new ContextError(ExitCode.UserError, error.message, {
        category: ErrorCategory.UserInputInvalid,
        revision_advanced: false,
        current_revision: current.revision,
        input_schema: "schema.resolve-current-indexer-gate.output",
        path_conflicts: current.path_preparation?.conflicts ?? [],
        next_action: {
          kind: "correct_layout_confirmation",
          message: "Use the current layout Gate, select a distinct readable path for each conflicting page, and resubmit the same revision.",
        },
      });
    }
    await advanceCurrentIndexerFinalization(found.projectRoot);
    const status = await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.status` }, () => collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    }));
    return {
      protocol: "context.indexer.current-action-completion/v2" as const,
      stage: semantic.stage,
      outcome: "approved",
      workflow: status.workflow,
    };
  }
  if (semantic.stage === "structure-review") {
    const { readKnowledgeUpdate, completeUpdateStructureReview } = await import("./knowledgeUpdate.js");
    if ((await readKnowledgeUpdate(found.projectRoot))?.structure_proposal) {
      await assertProjectWorkflowRevision({ cwd: found.projectRoot, expectedRevision: input.revision, managed: input.managed === true, authorities });
      const result = await completeUpdateStructureReview({ projectRoot: found.projectRoot, revision: input.revision,
        decision: semantic.decision, ...(semantic.feedback ? { feedback: semantic.feedback } : {}) });
      return completedRevisionReceipt(found.projectRoot, semantic.stage, result, input.managed === true, authorities);
    }
    const structure = await currentIndexerStructureReview(found.projectRoot);
    if (structure === undefined || structure.revision !== input.revision) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        "the current semantic structure review is stale",
        { category: ErrorCategory.WorkflowRevisionStale },
      );
    }
    if (
      input.managed === true &&
      !authorities.includes(CONTEXT_WORKFLOW_AUTHORITIES.knowledgeReview)
    ) {
      throw new ContextError(
        ExitCode.UserError,
        "managed semantic structure review requires knowledge-review authority",
        { category: ErrorCategory.UserInputInvalid },
      );
    }
    const nextStage = await completeCurrentIndexerStructureReview({
      projectRoot: found.projectRoot,
      revision: input.revision,
      decision: semantic.decision,
      ...(semantic.feedback === undefined ? {} : { feedback: semantic.feedback }),
    });
    if (nextStage === "partition" || structure.preview.topics.length === 0) {
      await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.advance` }, () => advanceCurrentIndexerLifecycle(found.projectRoot));
    }
    const status = await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.status` }, () => collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    }));
    return {
      protocol: "context.indexer.current-action-completion/v2" as const,
      stage: semantic.stage,
      outcome: semantic.decision,
      workflow: status.workflow,
    };
  }
  if (semantic.stage === "post-author") {
    return completeCurrentIndexerPostAuthorAction({
      projectRoot: found.projectRoot,
      revision: input.revision,
      semantic: { stage: "post-author", results: semantic.results },
      managed: input.managed === true,
      authorities,
      ...(input.inject_next_preparation_failure === undefined
        ? {}
        : { inject_next_preparation_failure: input.inject_next_preparation_failure }),
    });
  }
  const current = await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.read-current` }, () => resolveCurrentIndexerAgentContext(found.projectRoot));
  if (current === undefined) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "the current workflow route no longer has an Agent workset",
      {
        category: ErrorCategory.WorkflowRevisionStale,
        next: "context status --format json",
      },
    );
  }
  if (semantic.stage !== current.descriptor.stage) {
    throw new ContextError(
      ExitCode.UserError,
      `current ${current.descriptor.stage} batch cannot consume ${semantic.stage} input`,
      { category: ErrorCategory.UserInputInvalid },
    );
  }
  if (semantic.stage === "author") {
    if (input.preview) return previewAuthorBatch({ projectRoot: found.projectRoot, revision: input.revision,
      descriptor: current.descriptor, results: semantic.results });
    const accepted: Awaited<ReturnType<typeof prepareIndexerAuthorSubmission>>[] = [];
    const materials: Array<{ task_key: string; material: PreparedAuthorMaterial }> = [];
    const outcomes: IndexerTaskCompletionOutcome[] = [];
    const keyCounts = new Map<string, number>();
    for (const submitted of semantic.results) {
      keyCounts.set(submitted.task_key, (keyCounts.get(submitted.task_key) ?? 0) + 1);
    }
    const duplicateKeys = new Set([...keyCounts].filter(([, count]) => count > 1).map(
      ([taskKey]) => taskKey,
    ));
    for (const taskKey of duplicateKeys) {
      outcomes.push({
        task_key: taskKey,
        outcome: "failed",
        message: "current Author batch contains a duplicate task key",
      });
    }
    for (const submitted of semantic.results) {
      if (duplicateKeys.has(submitted.task_key)) continue;
      const parsed = indexerAuthorSemanticInputSchema.safeParse(submitted.result);
      if (!parsed.success) {
        outcomes.push(schemaFailure({
          stage: "author",
          task_key: submitted.task_key,
          result: submitted.result,
          issues: parsed.error.issues,
        }));
        continue;
      }
      try {
        const task = await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.read-task` }, () => loadCurrentIndexerBatchTask({
          projectRoot: found.projectRoot,
          descriptor: current.descriptor,
          taskKey: submitted.task_key,
        }));
        if (parsed.data.outcome === "request-material") {
          const material = await prepareIndexerAuthorMaterial({
            projectRoot: found.projectRoot, spec: task.spec, group_key: parsed.data.group_key,
            source_hints: parsed.data.material_gaps.flatMap((gap) => gap.source_hints),
          });
          materials.push({ task_key: submitted.task_key, material });
          continue;
        }
        accepted.push(await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.prepare-result` }, () => prepareIndexerAuthorSubmission({
          projectRoot: found.projectRoot, task, semantic: parsed.data,
        })));
      } catch (error) {
        outcomes.push({
          task_key: submitted.task_key,
          outcome: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const submittedKeys = new Set(semantic.results.map((result) => result.task_key));
    outcomes.push(...current.descriptor.tasks.filter((task) =>
      !submittedKeys.has(task.task_key)
    ).map((task) => ({
      task_key: task.task_key,
      outcome: "missing" as const,
      committed: false,
    })));
    if (accepted.length > 0) {
      const stored = await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.commit-results` }, () => acceptIndexerMainAuthorRunsStore({
        projectRoot: found.projectRoot,
        runs: accepted.map((item) => ({
          workset_digest: item.task.spec.request.workset.workset_digest,
          result: item.result,
        })),
      }));
      for (const item of accepted) {
        const storedOutcome = stored.outcomes.find((outcome) =>
          outcome.workset_digest === item.task.spec.request.workset.workset_digest
        );
        if (storedOutcome === undefined) {
          throw new TypeError("main Author batch store omitted a task outcome");
        }
        outcomes.push({
          task_key: item.task.descriptor.task_key,
          outcome: storedOutcome.outcome,
          committed: storedOutcome.committed,
          ...(storedOutcome.message === undefined
            ? {}
            : { message: storedOutcome.message }),
        });
        if (storedOutcome.outcome !== "accepted") continue;
        await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.persist-semantic` }, () => persistIndexerSemanticResult({
          projectRoot: found.projectRoot,
          requestDigest: item.task.spec.request.execution_request_digest,
          semantic: item.semantic,
        }));
      }
    }
    if (materials.length > 0) {
      try {
        await applyIndexerAuthorMaterials({ projectRoot: found.projectRoot, materials: materials.map((item) => item.material) });
        outcomes.push(...materials.map(({ task_key, material }) => ({
          task_key, outcome: "material-expanded", committed: false,
          message: `Complete source bodies available: ${material.paths.join(", ")}. Read the returned task's Source material or captured file paths and continue the preserved draft.${material.missing_paths.length ? ` Unavailable paths: ${material.missing_paths.join(", ")}.` : ""}`,
        })));
      } catch (error) {
        outcomes.push(...materials.map(({ task_key }) => ({ task_key, outcome: "failed", committed: false,
          message: error instanceof Error ? error.message : String(error) })));
      }
    }
    const continuation = await advanceAfterBatch({
      projectRoot: found.projectRoot,
      descriptor: current.descriptor,
      managed: input.managed === true,
      authorities,
      committedTaskCount: outcomes.filter((outcome) => outcome.committed === true).length,
      ...(input.inject_next_preparation_failure === undefined
        ? {}
        : { inject_next_preparation_failure: input.inject_next_preparation_failure }),
    });
    const { current_revision: revisionAfter, ...nextState } = continuation;
    return {
      protocol: "context.indexer.current-action-completion/v2" as const,
      stage: semantic.stage,
      submitted_slice: submittedProgressSlice(semantic.stage, outcomes),
      outcomes: outcomes.sort((left, right) => left.task_key.localeCompare(right.task_key)),
      revision_before: input.revision,
      revision_after: revisionAfter,
      revision_advanced: revisionAfter === null
        ? outcomes.some((outcome) => outcome.committed === true)
        : revisionAfter !== input.revision,
      ...nextState,
    };
  }
  const artifactLogicalUnits = (current.authority.manifest.provides.logical_units ?? [])
    .filter((unit) => unit.artifacts !== undefined);
  if (artifactLogicalUnits.length !== 1) {
    throw new TypeError(
      `Primary Provider ${current.authority.manifest.id} must declare exactly one artifact-bearing logical unit`,
    );
  }
  const prepared: Array<{
    task: Awaited<ReturnType<typeof loadCurrentIndexerBatchTask>>;
    semantic: ReturnType<typeof indexerPartitionSemanticInputSchema.parse>;
    result: ReturnType<typeof buildIndexerPartitionRunResultFromSemantic>;
  }> = [];
  const outcomes: IndexerTaskCompletionOutcome[] = [];
  const keyCounts = new Map<string, number>();
  for (const submitted of semantic.results) {
    keyCounts.set(submitted.task_key, (keyCounts.get(submitted.task_key) ?? 0) + 1);
  }
  const duplicateKeys = new Set([...keyCounts].filter(([, count]) => count > 1).map(
    ([taskKey]) => taskKey,
  ));
  for (const taskKey of duplicateKeys) {
    outcomes.push({
      task_key: taskKey,
      outcome: "failed",
      message: "current Partition batch contains a duplicate task key",
    });
  }
  for (const submitted of semantic.results) {
    if (duplicateKeys.has(submitted.task_key)) continue;
    const parsed = indexerPartitionSemanticInputSchema.safeParse(submitted.result);
    if (!parsed.success) {
      outcomes.push(schemaFailure({
        stage: "partition",
        task_key: submitted.task_key,
        result: submitted.result,
        issues: parsed.error.issues,
      }));
      continue;
    }
    try {
      const task = await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.read-task` }, () => loadCurrentIndexerBatchTask({
        projectRoot: found.projectRoot,
        descriptor: current.descriptor,
        taskKey: submitted.task_key,
      }));
      const validation = task.spec.validation as unknown as Omit<
        Parameters<typeof buildIndexerPartitionRunResultFromSemantic>[0]["validation"],
        "partition_unit_type"
      >;
      prepared.push({
        task,
        semantic: parsed.data,
        result: buildIndexerPartitionRunResultFromSemantic({
          request: task.spec.request,
          view: task.view,
          semantic: parsed.data,
          validation: {
            ...validation,
            partition_unit_type: artifactLogicalUnits[0]!.id,
          },
        }),
      });
    } catch (error) {
      outcomes.push({
        task_key: submitted.task_key,
        outcome: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const submittedKeys = new Set(semantic.results.map((result) => result.task_key));
  outcomes.push(...current.descriptor.tasks.filter((task) =>
    !submittedKeys.has(task.task_key)
  ).map((task) => ({
    task_key: task.task_key,
    outcome: "missing",
    committed: false,
  })));
  if (prepared.length > 0) {
    const converged = await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.commit-results` }, () => acceptIndexerMainPartitionRunsStore({
      projectRoot: found.projectRoot,
      runs: prepared.map((item) => ({
        workset_digest: item.task.spec.request.workset.workset_digest,
        result: item.result,
      })),
    }));
    for (const [index, item] of prepared.entries()) {
      const outcome = converged.outcomes[index]!;
      outcomes.push({
        task_key: item.task.descriptor.task_key,
        outcome: outcome.outcome,
        committed: outcome.committed,
        ...(outcome.message === undefined ? {} : { message: outcome.message }),
      });
      if (outcome.outcome === "accepted") {
        await measureContextDebugOperation({ projectRoot: found.projectRoot, operation: `indexer.completion.${semantic.stage}.persist-semantic` }, () => persistIndexerSemanticResult({
          projectRoot: found.projectRoot,
          requestDigest: item.task.spec.request.execution_request_digest,
          semantic: item.semantic,
        }));
      }
    }
  }
  const continuation = await advanceAfterBatch({
    projectRoot: found.projectRoot,
    descriptor: current.descriptor,
    managed: input.managed === true,
    authorities,
    committedTaskCount: outcomes.filter((outcome) => outcome.committed === true).length,
    ...(input.inject_next_preparation_failure === undefined
      ? {}
      : { inject_next_preparation_failure: input.inject_next_preparation_failure }),
  });
  const { current_revision: revisionAfter, ...nextState } = continuation;
  return {
    protocol: "context.indexer.current-action-completion/v2" as const,
    stage: semantic.stage,
    submitted_slice: submittedProgressSlice(semantic.stage, outcomes),
      outcomes: outcomes.sort((left, right) => left.task_key.localeCompare(right.task_key)),
    revision_before: input.revision,
    revision_after: revisionAfter,
    revision_advanced: revisionAfter === null
      ? outcomes.some((outcome) => outcome.committed === true)
      : revisionAfter !== input.revision,
    ...nextState,
  };
}

async function completedRevisionReceipt(projectRoot: string, stage: string, result: Record<string, unknown>,
  managed: boolean, authorities: readonly ContextWorkflowAuthority[]) {
  const receipt = { protocol: "context.indexer.current-action-completion/v2" as const, stage, ...result };
  try {
    const status = await collectProjectStatus(projectRoot, { managed, authorities });
    return { ...receipt, workflow: status.workflow };
  } catch (error) {
    return { ...receipt, next_preparation_error: error instanceof Error ? error.message : String(error),
      next_action: { command: "context status --format json" } };
  }
}
