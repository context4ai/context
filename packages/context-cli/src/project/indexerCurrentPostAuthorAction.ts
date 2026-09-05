import {
  indexerPostAuthorSemanticInputSchema,
  indexerProtocolDigest,
  type IndexerMainBatchSubmissionEnvelope,
  type IndexerPostAuthorSemanticInput,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { ContextWorkflowAuthority } from "./workflow/workflowTypes.js";
import { readCurrentIndexerComposerBatch } from "./indexerCurrentComposer.js";
import { advanceCurrentIndexerFinalization } from "./indexerCurrentFinalization.js";
import { currentIndexerProgress } from "./indexerCurrentProgress.js";
import { resolveCurrentIndexerWorkflowRoute } from "./indexerCurrentWorkflowRoute.js";
import {
  persistIndexerSemanticResult,
  schemaFailure,
  type IndexerTaskCompletionOutcome,
} from "./indexerCurrentActionShared.js";
import { completeIndexerPostAuthorRunsStore } from "./indexerPostAuthorRunStore.js";
import { buildIndexerPostAuthorResultFromSemantic } from
  "./indexerSemanticPostAuthorResult.js";

type PostAuthorSubmission = IndexerMainBatchSubmissionEnvelope & {
  stage: "post-author";
};

export async function completeCurrentIndexerPostAuthorAction(input: {
  projectRoot: string;
  revision: string;
  semantic: PostAuthorSubmission;
  managed: boolean;
  authorities: readonly ContextWorkflowAuthority[];
  inject_next_preparation_failure?: () => void | Promise<void>;
}) {
  const current = await readCurrentIndexerComposerBatch(input.projectRoot);
  if (current === undefined) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "the current workflow route no longer has a Composer workset",
      { category: ErrorCategory.WorkflowRevisionStale },
    );
  }
  const outcomes: IndexerTaskCompletionOutcome[] = [];
  const keyCounts = new Map<string, number>();
  for (const submitted of input.semantic.results) {
    keyCounts.set(submitted.task_key, (keyCounts.get(submitted.task_key) ?? 0) + 1);
  }
  const duplicateKeys = new Set([...keyCounts].filter(([, count]) => count > 1).map(
    ([taskKey]) => taskKey,
  ));
  for (const taskKey of duplicateKeys) {
    outcomes.push({
      task_key: taskKey,
      outcome: "failed",
      committed: false,
      message: "current Composer batch contains a duplicate task key",
    });
  }
  const completions: Array<{
    task: (typeof current.tasks)[number];
    semantic: IndexerPostAuthorSemanticInput;
    store: Parameters<typeof completeIndexerPostAuthorRunsStore>[0]["runs"][number];
  }> = [];
  for (const submitted of input.semantic.results) {
    if (duplicateKeys.has(submitted.task_key)) continue;
    const task = current.tasks.find((candidate) =>
      candidate.task_key === submitted.task_key
    );
    if (task === undefined) {
      outcomes.push({
        task_key: submitted.task_key,
        outcome: "failed",
        committed: false,
        message: "current Composer batch has no such task key",
      });
      continue;
    }
    const parsed = indexerPostAuthorSemanticInputSchema.safeParse(submitted.result);
    if (!parsed.success) {
      outcomes.push(schemaFailure({
        stage: "post-author",
        task_key: submitted.task_key,
        result: submitted.result,
        issues: parsed.error.issues,
      }));
      continue;
    }
    const context = task.context;
    if (parsed.data.outcome === "failed") {
      completions.push({
        task,
        semantic: parsed.data,
        store: {
          plan: context.plan,
          ledger: context.ledger,
          composer_ref: context.request.composer_ref,
          outcome: "fail",
          reason_code: parsed.data.diagnostics[0]!.code,
          dependency_digests: [indexerProtocolDigest(parsed.data.diagnostics)],
        },
      });
      continue;
    }
    if (context.composer.contract === undefined) {
      outcomes.push({
        task_key: submitted.task_key,
        outcome: "failed",
        committed: false,
        message: `Composer ${context.composer.id} has no executable contract`,
      });
      continue;
    }
    try {
      const result = buildIndexerPostAuthorResultFromSemantic({
        request: context.request,
        primary_artifact_result: context.record.artifact_result,
        semantic: parsed.data,
        allowed_artifact_kinds:
          context.composer.contract.derived_artifact_policy.artifact_kinds,
        artifact_policy_variant:
          context.composer.contract.derived_artifact_policy.artifact_policy_variant,
      });
      completions.push({
        task,
        semantic: parsed.data,
        store: {
          plan: context.plan,
          ledger: context.ledger,
          composer_ref: context.request.composer_ref,
          outcome: "accept",
          result,
          validator_contract_digest: context.validator_contract_digest,
        },
      });
    } catch (error) {
      outcomes.push({
        task_key: submitted.task_key,
        outcome: "failed",
        committed: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const submittedKeys = new Set(input.semantic.results.map((result) => result.task_key));
  outcomes.push(...current.tasks.filter((task) =>
    !submittedKeys.has(task.task_key)
  ).map((task) => ({
    task_key: task.task_key,
    outcome: "missing",
    committed: false,
  })));
  if (completions.length > 0) {
    const stored = await completeIndexerPostAuthorRunsStore({
      projectRoot: input.projectRoot,
      runs: completions.map((completion) => completion.store),
    });
    for (const completion of completions) {
      const context = completion.task.context;
      const storedOutcome = stored.outcomes.find((outcome) =>
        outcome.author_workset_digest ===
          context.plan.workset_set.author_workset_digest
      );
      if (storedOutcome === undefined) {
        throw new TypeError("Composer batch store omitted a task outcome");
      }
      outcomes.push({
        task_key: completion.task.task_key,
        outcome: storedOutcome.outcome,
        committed: storedOutcome.committed,
        ...(storedOutcome.message === undefined
          ? {}
          : { message: storedOutcome.message }),
      });
      if (!storedOutcome.committed) continue;
      await persistIndexerSemanticResult({
        projectRoot: input.projectRoot,
        requestDigest: context.request.request_digest,
        semantic: completion.semantic,
      });
    }
  }
  let next: Awaited<ReturnType<typeof resolveCurrentIndexerWorkflowRoute>> = undefined;
  let revisionAfter: string | null = null;
  let progress: Awaited<ReturnType<typeof currentIndexerProgress>> | null = null;
  let nextPreparation: { outcome: "failed"; message: string; command: string } | undefined;
  try {
    await input.inject_next_preparation_failure?.();
    await advanceCurrentIndexerFinalization(input.projectRoot);
    next = await resolveCurrentIndexerWorkflowRoute({
      projectRoot: input.projectRoot,
      managed: input.managed,
      authorities: input.authorities,
    });
    revisionAfter = next?.revision ?? null;
    progress = await currentIndexerProgress({
      projectRoot: input.projectRoot,
      ...(next === undefined ? {} : { route: next }),
    });
  } catch (error) {
    nextPreparation = {
      outcome: "failed",
      message: error instanceof Error ? error.message : String(error),
      command: `context run${input.managed ? " --managed" : ""} --format json`,
    };
    progress = await currentIndexerProgress({ projectRoot: input.projectRoot });
  }
  return {
    protocol: "context.indexer.current-action-completion/v2" as const,
    stage: input.semantic.stage,
    outcomes: outcomes.sort((left, right) => left.task_key.localeCompare(right.task_key)),
    revision_before: input.revision,
    revision_after: revisionAfter,
    revision_advanced: revisionAfter === null
      ? outcomes.some((outcome) => outcome.committed === true)
      : revisionAfter !== input.revision,
    next: next ?? null,
    progress,
    ...(nextPreparation === undefined ? {} : { next_preparation: nextPreparation }),
  };
}
