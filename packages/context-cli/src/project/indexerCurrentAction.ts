import { parseIndexerCurrentActionSubmission } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { collectProjectStatus } from "./status.js";
import { assertProjectWorkflowRevision } from "./statusCommand.js";
import { findContextProjectRoot } from "./workspace.js";
import { contextWorkflowAuthorities } from "./workflow/workflowFacts.js";
import type { ContextWorkflowAuthority } from "./workflow/workflowTypes.js";
import { readProductionStage } from "./productionStageStore.js";
import { completeCurrentProductionAction } from "./productionAction.js";
import { readApprovedRevision } from "./approvedRevision.js";
import { readKnowledgeUpdate } from "./knowledgeUpdate.js";
import { withProductionFeedback } from "./productionFeedback.js";

/** A retained production stage does not own a separately active maintenance
 * revision or source update. Both command decoding and dispatch use this rule. */
export async function currentProductionOwnsAction(projectRoot: string): Promise<boolean> {
  if (!await readProductionStage(projectRoot)) return false;
  return !await readApprovedRevision(projectRoot) && !await readKnowledgeUpdate(projectRoot);
}

export async function completeCurrentIndexerAction(input: {
  cwd: string;
  revision: string;
  value: unknown;
  submissionPath?: string;
  multiAgent?: boolean;
  managed?: boolean;
  authorities?: readonly ContextWorkflowAuthority[];
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
  if (await currentProductionOwnsAction(found.projectRoot)) return completeCurrentProductionAction({ ...input, projectRoot: found.projectRoot });
  return withProductionFeedback({ operation: "maintenance-action", file: input.submissionPath }, async () => {
  const authorities = contextWorkflowAuthorities({
    managed: input.managed === true,
    ...(input.authorities === undefined ? {} : { authorities: input.authorities }),
  });
  const stage = input.value && typeof input.value === "object" && "stage" in input.value ? input.value.stage : undefined;
  if (!["source-update", "approved-revision", "structure-review"].includes(String(stage))) {
    throw new ContextError(ExitCode.UserError, "Use the current production file submission or the active revision action.", {
      category: ErrorCategory.UserInputInvalid, reason_code: "unsupported-current-action",
      ...(await readApprovedRevision(found.projectRoot) ? { expected_stage: "approved-revision",
        hint: "Submit the active revision with stage: approved-revision and its current revision token. Do not clear the task or remove sources to repair a payload." } : {}),
      next_action: { command: "context status --format json" },
    });
  }
  const semantic = parseIndexerCurrentActionSubmission(input.value);
  if (input.preview && semantic.stage !== "approved-revision") throw new TypeError("--preview applies only to an approved-revision Route; stage file submissions use their current acceptance and repair flow");
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
    const content = "markdown" in semantic ? { markdown: semantic.markdown,
      ...(semantic.sections === undefined ? {} : { sections: semantic.sections }) } : { sections: semantic.sections };
    if (input.preview) return completeApprovedRevision({ projectRoot: found.projectRoot,
      revision: input.revision, ...content, preview: true });
    const candidate = await completeApprovedRevision({ projectRoot: found.projectRoot,
      revision: input.revision, ...content });
    return completedRevisionReceipt(found.projectRoot, semantic.stage,
      { outcome: candidate === undefined ? "unchanged" : "candidate-prepared",
        ...(candidate === undefined ? {} : { candidate_id: candidate.candidate_id }) }, input.managed === true, authorities);
  }
  if (semantic.stage === "structure-review") {
    const { readKnowledgeUpdate, completeUpdateStructureReview } = await import("./knowledgeUpdate.js");
    if ((await readKnowledgeUpdate(found.projectRoot))?.structure_proposal) {
      if (semantic.knowledge_map !== undefined) {
        throw new TypeError("This source-update review approves new source-bound pages. Apply its knowledge_map edit with context task adjust --input - --format json, then submit this review without knowledge_map; the existing source task is preserved.");
      }
      await assertProjectWorkflowRevision({ cwd: found.projectRoot, expectedRevision: input.revision, managed: input.managed === true, authorities });
      const result = await completeUpdateStructureReview({ projectRoot: found.projectRoot, revision: input.revision,
        decision: semantic.decision, ...(semantic.feedback ? { feedback: semantic.feedback } : {}) });
      return completedRevisionReceipt(found.projectRoot, semantic.stage, result, input.managed === true, authorities);
    }
  }
  throw new ContextError(ExitCode.WorkspaceStateError, "No current source-update structure proposal is awaiting this decision.", {
    category: ErrorCategory.WorkspaceStateInvalid, reason_code: "no-current-structure-proposal",
    next_action: { command: "context status --format json" },
  });
  });
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
