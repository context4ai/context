import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { indexerProtocolDigest, parseIndexerCurrentActionSubmission } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { prepareApprovedRevision, readApprovedRevision, resolveApprovedRevisionAuthor } from "./approvedRevision.js";
import { approvedRevisionContext } from "./approvedRevisionContext.js";
import { buildApprovedRevisionRoute } from "./approvedRevisionRoute.js";
import { collectProjectStatus } from "./status.js";
import { workspaceContentSnapshot } from "./workspaceContentSnapshot.js";
import { withProjectWriteLock } from "./writeLock.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { productionAgentDirectory, productionSubmissionSchema, readProductionFile, readProductionSubmission } from "./productionSubmissionFiles.js";
import { markSubmissionState, withSubmissionState, type SubmissionState } from "./submissionState.js";
import { contextWorkflowAuthorities } from "./workflow/workflowFacts.js";
import type { ContextResolvedWorkflowRoute, ContextWorkflowAuthority } from "./workflow/workflowTypes.js";

const issuedSchema = z.object({
  workspace: z.string(), reading: z.string(),
  tasks: z.array(z.object({ task: z.string(), revision: z.string(), context: z.string(), input: z.string() }).strict()).min(1).max(50),
}).strict();
const stageId = (issued: z.infer<typeof issuedSchema>) => `revision-${indexerProtocolDigest(issued).slice(7)}`;
const readingDigest = (route: ContextResolvedWorkflowRoute) => indexerProtocolDigest(route.resources);
const workspaceDigest = async (root: string) => indexerProtocolDigest(await workspaceContentSnapshot(root));

function paused(message: string, managed?: boolean) {
  return new ContextError(ExitCode.WorkspaceStateError, message, {
    category: ErrorCategory.WorkspaceStateInvalid, reason_code: "revision-batch-paused",
    next_action: { command: `context status${managed ? " --managed" : ""} --format json`, instruction: "Keep committed tasks. Read the current Route; prepare again if inputs changed, otherwise submit only the remaining tasks." },
    input_schema: { stage: "CLI-issued stage", tasks: "Uncommitted tasks with their original input tokens and stage-relative result files" },
  });
}

/** The existing tasks[] transport also carries prewritten maintenance pages.
 * Only ignored Agent files are prepared; there is no new workflow journal. */
export async function prepareApprovedRevisionSubmission(input: {
  projectRoot: string; revision: string; managed?: boolean; authorities?: readonly ContextWorkflowAuthority[];
}) {
  return withProjectWriteLock(input.projectRoot, "prepare-revision-submission", async () => {
    const authorities = contextWorkflowAuthorities(input);
    const route = (await collectProjectStatus(input.projectRoot, { managed: input.managed === true, authorities })).workflow.current;
    if (route?.revision !== input.revision || route.action?.id !== "author-approved-revision" || route.availability !== "immediate") {
      throw paused("Batch preparation requires the current immediate approved-revision Author Route.", input.managed);
    }
    const request = await resolveApprovedRevisionAuthor(input.projectRoot, await readApprovedRevision(input.projectRoot));
    if (!request || request.refresh_sources || request.merge_context) throw paused("Finish source refresh or conflict recovery before preparing a batch.", input.managed);
    const workspace = await workspaceDigest(input.projectRoot);
    const reading = readingDigest(route);
    const requests = [request];
    // The existing delivery selector caps a Review wave at 50 pages. Preparing
    // is not permission to cross that boundary: each actual Route is rechecked.
    for (const [index, next] of (request.pending_targets ?? []).slice(0, 49).entries()) {
      const prepared = await prepareApprovedRevision({ projectRoot: input.projectRoot, replace_current: true, persist: false,
        selector: next.path, instruction: next.instruction, pending_targets: request.pending_targets!.slice(index + 1),
        ...(request.batch_candidates ? { batch_candidates: request.batch_candidates } : {}),
        ...(request.requirements ? { requirements: request.requirements } : {}), ...(request.processed_scopes ? { processed_scopes: request.processed_scopes } : {}),
        ...(next.regenerate ? { regenerate: true } : {}), ...(next.target ? { target: next.target } : {}),
        ...(next.create ? { create: next.create } : {}), ...(next.supporting_sources ? { supporting_sources: next.supporting_sources } : {}) });
      requests.push(prepared.request);
    }
    const contexts = await Promise.all(requests.map(request => approvedRevisionContext(input.projectRoot, request.target)));
    if (await workspaceDigest(input.projectRoot) !== workspace) throw paused("Workspace inputs changed during preparation. Prepare from the new Route.", input.managed);
    const issued = { workspace, reading, tasks: requests.map((request, index) => ({
      task: `page-${index + 1}`, revision: request.revision, context: indexerProtocolDigest(contexts[index]),
      input: indexerProtocolDigest({ workspace, reading, revision: request.revision, context: contexts[index] }),
    })) };
    const stage = stageId(issued);
    const directory = productionAgentDirectory(stage);
    await atomicWriteFile(await safeProjectTarget(input.projectRoot, join(directory, "issued.json")), JSON.stringify(issued));
    for (const [index, request] of requests.entries()) {
      await atomicWriteFile(await safeProjectTarget(input.projectRoot, join(directory, `${issued.tasks[index]!.task}.input.json`)),
        JSON.stringify({ stage: "approved-revision", revision: request.revision, instruction: request.instruction,
          target: request.target, program_blocks: request.program_blocks ?? [], writing_context: contexts[index] }, null, 2));
    }
    return { stage, agent_directory: directory, tasks: issued.tasks.map((task, index) => ({ ...task,
      path: requests[index]!.target.path, task_input: join(directory, `${task.task}.input.json`) })),
      submission: { stage, tasks: issued.tasks.map(task => ({ task: task.task, input: task.input, edits: `${task.task}.edits.json` })) },
      next_action: { command: route.commands[0]!.command,
        instruction: "Write each edits file as the existing approved-revision semantic payload (stage plus markdown/sections), or use content plus a references file containing sections. Submit an ordered completed prefix, using paths relative to agent_directory. Follow each task input and current reading resources. Never resubmit committed tasks; submit the remaining suffix with the returned Route revision." } };
  });
}

/** Each item has the same lock and transaction as a single submission. The
 * command cache may survive between pages; authority observations never do. */
export async function completeApprovedRevisionSubmission(input: {
  projectRoot: string; revision: string; value: unknown; managed?: boolean; authorities?: readonly ContextWorkflowAuthority[]; preview?: boolean;
}) {
  if (input.preview) throw paused("Batch preview is not supported. Preview one approved-revision payload at a time without advancing its Route.", input.managed);
  const manifest = productionSubmissionSchema.parse(input.value);
  const issued = issuedSchema.parse(JSON.parse((await readProductionFile({ projectRoot: input.projectRoot, stage: manifest.stage, path: "issued.json" })).text));
  if (stageId(issued) !== manifest.stage) throw paused("The issued batch inputs changed. Prepare the current batch again.", input.managed);
  const text = JSON.stringify(manifest);
  const fixed = await readProductionSubmission({ projectRoot: input.projectRoot, stage: manifest.stage, path: "submission.json",
    manifest: { path: "submission.json", text, bytes: Buffer.byteLength(text), digest: indexerProtocolDigest(manifest) } });
  // Fix and parse every draft before committing the first article. Semantic
  // source and conflict validation still happens inside each page transaction.
  const tasks = fixed.tasks.map(task => {
    const issuedTask = issued.tasks.find(item => item.task === task.task && item.input === task.input);
    if (!issuedTask) throw paused(`Task ${task.task} does not match its issued input.`, input.managed);
    const value = task.edits ? YAML.parse(task.edits.text) : {
      stage: "approved-revision", markdown: task.content!.text, ...z.object({ sections: z.array(z.unknown()) }).strict().parse(YAML.parse(task.references!.text)),
    };
    const semantic = parseIndexerCurrentActionSubmission(value);
    if (semantic.stage !== "approved-revision") throw paused(`Task ${task.task} is not an approved revision.`, input.managed);
    return { task, issuedTask, semantic };
  });
  const indices = tasks.map(item => issued.tasks.indexOf(item.issuedTask));
  if (indices.some((value, index) => index > 0 && value !== indices[index - 1]! + 1)) throw paused("Submit an ordered contiguous set of unfinished tasks.", input.managed);
  const authorities = contextWorkflowAuthorities(input);
  const statusCommand = `context status${input.managed ? " --managed" : ""} --format json`;
  const outcomes: Array<Record<string, unknown>> = [];
  let revision = input.revision;
  let workflow: Awaited<ReturnType<typeof collectProjectStatus>>["workflow"] | undefined;
  let nextPreparation: { outcome: string; message: string; command: string } | undefined;
  let state: SubmissionState = "not-committed";
  for (const { task, issuedTask, semantic } of tasks) {
    try {
      const result = await withSubmissionState(() => withProjectWriteLock(input.projectRoot, "submit-revision-page", async () => {
        const route = await buildApprovedRevisionRoute({ projectRoot: input.projectRoot, managed: input.managed === true, authorities });
        if (route?.action?.id !== "author-approved-revision" || route.availability !== "immediate" || route.revision !== revision || route.revision !== issuedTask.revision) {
          throw paused("The next Route requires a different action or task input. Continue from that Route.", input.managed);
        }
        if (indexerProtocolDigest((route.action.input as Record<string, unknown>).writing_context) !== issuedTask.context || readingDigest(route) !== issued.reading || await workspaceDigest(input.projectRoot) !== issued.workspace) {
          throw paused("Source, article or reading inputs changed. Read the current Route and prepare new task inputs.", input.managed);
        }
        const { completeCurrentIndexerAction } = await import("./indexerCurrentAction.js");
        return completeCurrentIndexerAction({ cwd: input.projectRoot, revision, value: semantic, managed: input.managed === true, authorities });
      }), { fresh: true, managed: input.managed === true });
      const receipt = result as { outcome?: string; submission_state?: SubmissionState; workflow?: typeof workflow; next_preparation_error?: string };
      state = receipt.submission_state ?? "committed";
      outcomes.push({ task_key: task.task, input: task.input, outcome: receipt.outcome ?? "candidate-prepared", committed: state === "committed" });
      workflow = receipt.workflow;
      const next = workflow?.current;
      if (receipt.next_preparation_error || !next || next.action?.id !== "author-approved-revision" || next.availability !== "immediate") {
        nextPreparation = { outcome: receipt.next_preparation_error ? "failed" : "paused",
          message: receipt.next_preparation_error ?? "Follow the returned Route before submitting further pages.", command: statusCommand };
        break;
      }
      revision = next.revision;
    } catch (error) {
      const detail = error instanceof ContextError ? error.detail : undefined;
      const itemState = (detail?.submission_state ?? "not-committed") as SubmissionState;
      if (itemState !== "not-committed") state = itemState;
      outcomes.push({ task_key: task.task, input: task.input, outcome: "paused", committed: itemState === "committed",
        submission_state: itemState, message: error instanceof Error ? error.message : String(error) });
      nextPreparation = { outcome: "failed", message: error instanceof Error ? error.message : String(error),
        command: itemState === "uncertain" ? `context task recover --operation transactions${input.managed ? " --managed" : ""} --format json` : statusCommand };
      // A prior Route is no longer authoritative after rejection or a race.
      workflow = undefined;
      break;
    }
  }
  markSubmissionState(state);
  const accepted = outcomes.filter(item => item.committed === true).length;
  return { protocol: "context.indexer.current-action-completion/v2", stage: "approved-revision", submission_state: state,
    outcome: accepted === tasks.length ? "accepted" : "paused", outcomes,
    progress: { total: tasks.length, accepted, pending: tasks.length - accepted },
    ...(workflow ? { workflow } : {}), ...(nextPreparation ? { next_preparation: nextPreparation } : {}) };
}
