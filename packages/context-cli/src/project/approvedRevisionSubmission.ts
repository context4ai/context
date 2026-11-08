import { removedCitations, REMOVED_CITATIONS_NOTE } from "./approvedRevisionReferences.js";
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
import { authorityCommandOptions } from "./workflow/workflowProvider.js";
import type { ContextResolvedWorkflowRoute, ContextWorkflowAuthority } from "./workflow/workflowTypes.js";

const issuedSchema = z.object({
  workspace: z.string(), reading: z.string(),
  tasks: z.array(z.object({ task: z.string(), revision: z.string(), context: z.string(), input: z.string() }).strict()).min(1).max(50),
}).strict();
const stageId = (issued: z.infer<typeof issuedSchema>) => `revision-${indexerProtocolDigest(issued).slice(7)}`;
const readingDigest = (route: ContextResolvedWorkflowRoute) => indexerProtocolDigest(route.resources);
const workspaceDigest = async (root: string) => indexerProtocolDigest(await workspaceContentSnapshot(root));

function paused(message: string, managed?: boolean, authorities: readonly ContextWorkflowAuthority[] = []) {
  return new ContextError(ExitCode.WorkspaceStateError, message, {
    category: ErrorCategory.WorkspaceStateInvalid, reason_code: "revision-batch-paused",
    next_action: { command: `context${authorityCommandOptions(authorities, "workflow")} status${managed ? " --managed" : ""} --format json`, instruction: "Keep committed tasks. Read the current Route; prepare again if inputs changed, otherwise submit only the remaining tasks." },
    input_schema: { stage: "CLI-issued stage", tasks: "Uncommitted tasks with their original input tokens and stage-relative result files" },
  });
}

/** The current Route's batch inputs, computed without writing: preparation
 * stores them, and a batch preview compares the stored ones against them. */
async function issueRevisionBatch(input: { projectRoot: string; revision: string; managed?: boolean; authorities?: readonly ContextWorkflowAuthority[] }) {
  const authorities = contextWorkflowAuthorities(input);
  const route = (await collectProjectStatus(input.projectRoot, { managed: input.managed === true, authorities })).workflow.current;
  if (route?.revision !== input.revision || route.action?.id !== "author-approved-revision" || route.availability !== "immediate") {
    throw paused("Batch preparation requires the current immediate approved-revision Author Route.", input.managed, input.authorities);
  }
  const request = await resolveApprovedRevisionAuthor(input.projectRoot, await readApprovedRevision(input.projectRoot));
  if (!request || request.refresh_sources || request.merge_context) throw paused("Finish source refresh or conflict recovery before preparing a batch.", input.managed, input.authorities);
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
  if (await workspaceDigest(input.projectRoot) !== workspace) throw paused("Workspace inputs changed during preparation. Prepare from the new Route.", input.managed, input.authorities);
  const issued = { workspace, reading, tasks: requests.map((request, index) => ({
    task: `page-${index + 1}`, revision: request.revision, context: indexerProtocolDigest(contexts[index]),
    input: indexerProtocolDigest({ workspace, reading, revision: request.revision, context: contexts[index] }),
  })) };
  return { route, requests, contexts, issued };
}

/** The existing tasks[] transport also carries prewritten maintenance pages.
 * Only ignored Agent files are prepared; there is no new workflow journal. */
export async function prepareApprovedRevisionSubmission(input: {
  projectRoot: string; revision: string; managed?: boolean; authorities?: readonly ContextWorkflowAuthority[];
}) {
  return withProjectWriteLock(input.projectRoot, "prepare-revision-submission", async () => {
    const { route, requests, contexts, issued } = await issueRevisionBatch(input);
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
        instruction: "Write each edits file as the existing approved-revision semantic payload (stage plus markdown/sections), or use content plus a references file containing sections. Submit an ordered completed prefix, using paths relative to agent_directory. Follow each task input and current reading resources. Never resubmit committed tasks; submit the remaining suffix with the returned Route revision. Before the first submission, run the same submit command once with --preview: it checks every page and saves nothing." } };
  });
}

/** Each item has the same lock and transaction as a single submission. The
 * command cache may survive between pages; authority observations never do. */
export async function completeApprovedRevisionSubmission(input: {
  projectRoot: string; revision: string; value: unknown; managed?: boolean; authorities?: readonly ContextWorkflowAuthority[]; preview?: boolean;
}) {
  if (input.preview) return withProjectWriteLock(input.projectRoot, "preview-revision-submission", () => previewApprovedRevisionSubmission(input));
  const manifest = productionSubmissionSchema.parse(input.value);
  const issued = issuedSchema.parse(JSON.parse((await readProductionFile({ projectRoot: input.projectRoot, stage: manifest.stage, path: "issued.json" })).text));
  if (stageId(issued) !== manifest.stage) throw paused("The issued batch inputs changed. Prepare the current batch again.", input.managed, input.authorities);
  const text = JSON.stringify(manifest);
  const fixed = await readProductionSubmission({ projectRoot: input.projectRoot, stage: manifest.stage, path: "submission.json",
    manifest: { path: "submission.json", text, bytes: Buffer.byteLength(text), digest: indexerProtocolDigest(manifest) } });
  // Fix and parse every draft before committing the first article. Semantic
  // source and conflict validation still happens inside each page transaction.
  const tasks = fixed.tasks.map(task => {
    const issuedTask = issued.tasks.find(item => item.task === task.task && item.input === task.input);
    if (!issuedTask) throw paused(`Task ${task.task} does not match its issued input.`, input.managed, input.authorities);
    const value = task.edits ? YAML.parse(task.edits.text) : {
      stage: "approved-revision", markdown: task.content!.text, ...z.object({ sections: z.array(z.unknown()) }).strict().parse(YAML.parse(task.references!.text)),
    };
    const semantic = parseIndexerCurrentActionSubmission(value);
    if (semantic.stage !== "approved-revision") throw paused(`Task ${task.task} is not an approved revision.`, input.managed, input.authorities);
    return { task, issuedTask, semantic };
  });
  const indices = tasks.map(item => issued.tasks.indexOf(item.issuedTask));
  if (indices.some((value, index) => index > 0 && value !== indices[index - 1]! + 1)) throw paused("Submit an ordered contiguous set of unfinished tasks.", input.managed, input.authorities);
  const authorities = contextWorkflowAuthorities(input);
  // Returned commands keep this session's managed mode and explicit authorities.
  const rootOptions = authorityCommandOptions(input.authorities ?? [], "workflow");
  const statusCommand = `context${rootOptions} status${input.managed ? " --managed" : ""} --format json`;
  const outcomes: Array<Record<string, unknown>> = [];
  let revision = input.revision;
  let workflow: Awaited<ReturnType<typeof collectProjectStatus>>["workflow"] | undefined;
  let nextPreparation: { outcome: string; message: string; command: string; choices?: Array<{ action: string; instruction: string; command: string }> } | undefined;
  let state: SubmissionState = "not-committed";
  for (const { task, issuedTask, semantic } of tasks) {
    try {
      const result = await withSubmissionState(() => withProjectWriteLock(input.projectRoot, "submit-revision-page", async () => {
        const route = await buildApprovedRevisionRoute({ projectRoot: input.projectRoot, managed: input.managed === true, authorities });
        if (route?.action?.id !== "author-approved-revision" || route.availability !== "immediate" || route.revision !== revision || route.revision !== issuedTask.revision) {
          throw paused("The next Route requires a different action or task input. Continue from that Route.", input.managed, input.authorities);
        }
        if (indexerProtocolDigest((route.action.input as Record<string, unknown>).writing_context) !== issuedTask.context || readingDigest(route) !== issued.reading || await workspaceDigest(input.projectRoot) !== issued.workspace) {
          throw paused("Source, article or reading inputs changed. Read the current Route and prepare new task inputs.", input.managed, input.authorities);
        }
        const { completeCurrentIndexerAction } = await import("./indexerCurrentAction.js");
        return completeCurrentIndexerAction({ cwd: input.projectRoot, revision, value: semantic, managed: input.managed === true, authorities });
      }), { fresh: true, managed: input.managed === true });
      const receipt = result as { outcome?: string; submission_state?: SubmissionState; workflow?: typeof workflow; next_preparation_error?: string;
        removed_citations?: unknown[]; removed_citations_note?: string };
      state = receipt.submission_state ?? "committed";
      outcomes.push({ task_key: task.task, input: task.input, outcome: receipt.outcome ?? "candidate-prepared", committed: state === "committed",
        ...(receipt.removed_citations?.length ? { removed_citations: receipt.removed_citations, removed_citations_note: receipt.removed_citations_note } : {}) });
      workflow = receipt.workflow;
      const next = workflow?.current;
      if (receipt.next_preparation_error || !next || next.action?.id !== "author-approved-revision" || next.availability !== "immediate") {
        // Accepted pages whose Route moved on to another action are not a pause.
        nextPreparation = receipt.next_preparation_error ? { outcome: "failed", message: receipt.next_preparation_error, command: statusCommand }
          : { outcome: "continue-route", message: "Accepted. The Route continues with a different action; follow it before submitting further pages.", command: statusCommand };
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
        command: itemState === "uncertain" ? `context${rootOptions} task recover --operation transactions${input.managed ? " --managed" : ""} --format json` : statusCommand,
        // An out-of-scope citation may be a wrong citation, not a missing source.
        ...(detail?.reason_code === "source-outside-revision" ? { choices: [
          { action: "correct-reference", instruction: "If the citation is wrong, cite an allowed source of this revision and submit the remaining tasks again.", command: statusCommand },
          { action: "adjust-scope", instruction: "Only when this revision is authorized to use the new source: register it, associate it with the selected requirement in src/indexers.yaml, then adjust this revision's sources.", command: `context${rootOptions}${input.managed ? " --workflow-managed" : ""} task adjust --input - --format json` },
        ] } : {}) };
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

type PreviewIssue = { message: string; path?: ReadonlyArray<string | number>; reason_code?: string };
/** Check every page of a prepared batch with the same composition and checks as
 * submission, against each page's issued input. No workflow state is saved: no task
 * advance, candidate or source-region cache. Single-page previews are unchanged. */
async function previewApprovedRevisionSubmission(input: { projectRoot: string; revision: string; value: unknown; managed?: boolean;
  authorities?: readonly ContextWorkflowAuthority[] }) {
  let manifest: z.infer<typeof productionSubmissionSchema>;
  let issued: z.infer<typeof issuedSchema>;
  try {
    manifest = productionSubmissionSchema.parse(input.value);
    issued = issuedSchema.parse(JSON.parse((await readProductionFile({ projectRoot: input.projectRoot, stage: manifest.stage, path: "issued.json" })).text));
  } catch (error) {
    throw paused(`The batch submission or its issued inputs cannot be read (${error instanceof Error ? error.message.split("\n")[0] : String(error)}). Prepare the current batch again.`, input.managed, input.authorities);
  }
  if (stageId(issued) !== manifest.stage) throw paused("The issued batch inputs changed. Prepare the current batch again.", input.managed, input.authorities);
  // Same binding as submission: the current Route, workspace and reading must
  // still produce the issued inputs, starting with the Route's current page.
  const current = await issueRevisionBatch(input);
  if (current.issued.workspace !== issued.workspace || current.issued.reading !== issued.reading) {
    throw paused("Source, article or reading inputs changed. Read the current Route and prepare new task inputs.", input.managed, input.authorities);
  }
  const text = JSON.stringify(manifest);
  const fixed = await readProductionSubmission({ projectRoot: input.projectRoot, stage: manifest.stage, path: "submission.json",
    manifest: { path: "submission.json", text, bytes: Buffer.byteLength(text), digest: indexerProtocolDigest(manifest) } });
  const first = issued.tasks.findIndex(item => item.task === fixed.tasks[0]?.task && item.input === fixed.tasks[0]?.input);
  const stale = (index: number) => {
    const issuedTask = issued.tasks[first + index];
    const now = current.issued.tasks[index];
    return first < 0 || !issuedTask || !now || issuedTask.task !== fixed.tasks[index]!.task || issuedTask.input !== fixed.tasks[index]!.input ||
      now.revision !== issuedTask.revision || now.context !== issuedTask.context;
  };
  const { composeRevisionCandidate } = await import("./approvedRevision.js");
  const { SubmissionInputError } = await import("./productionFeedback.js");
  const issue = (error: unknown): PreviewIssue => error instanceof SubmissionInputError
    ? { message: error.message, path: error.path, ...(error.reason ? { reason_code: error.reason } : {}) }
    : error instanceof z.ZodError ? { message: error.issues.map(item => item.message).join("; ") }
    : { message: error instanceof Error ? error.message : String(error) };
  const pages = [];
  for (const [index, task] of fixed.tasks.entries()) {
    if (!issued.tasks.some(item => item.task === task.task && item.input === task.input)) {
      pages.push({ task: task.task, ok: false, issues: [{ message: `Task ${task.task} does not match its issued input.`, reason_code: "task-input-mismatch" }] });
      continue;
    }
    if (stale(index)) {
      pages.push({ task: task.task, ok: false, issues: [{ reason_code: "task-input-stale",
        message: `Task ${task.task} no longer matches the current Route's inputs (the batch changed after preparation or is not the next unfinished suffix). Prepare the current batch again.` }] });
      continue;
    }
    try {
      const value = task.edits ? YAML.parse(task.edits.text) : {
        stage: "approved-revision", markdown: task.content!.text, ...z.object({ sections: z.array(z.unknown()) }).strict().parse(YAML.parse(task.references!.text)),
      };
      const semantic = parseIndexerCurrentActionSubmission(value);
      if (semantic.stage !== "approved-revision") throw new TypeError(`Task ${task.task} is not an approved revision.`);
      const request = JSON.parse((await readProductionFile({ projectRoot: input.projectRoot, stage: manifest.stage, path: `${task.task}.input.json` })).text);
      const content = "markdown" in semantic ? { markdown: semantic.markdown, ...(semantic.sections === undefined ? {} : { sections: semantic.sections }) }
        : { sections: semantic.sections };
      const { markdown, references } = await composeRevisionCandidate(input.projectRoot, request, content, { remember: false });
      const removed = removedCitations(request.target.sections, references);
      pages.push({ task: task.task, path: request.target.path, ok: true, issues: [],
        changed: markdown !== request.target.markdown || indexerProtocolDigest(references) !== indexerProtocolDigest(request.target.sections),
        ...(removed.length ? { removed_citations: removed, removed_citations_note: REMOVED_CITATIONS_NOTE } : {}) });
    } catch (error) {
      pages.push({ task: task.task, ok: false, issues: [issue(error)] });
    }
  }
  const reissue = pages.some(page => page.issues.some(issue => issue.reason_code === "task-input-stale"));
  return { protocol: "context.approved-revision-batch-preview/v1", stage: manifest.stage, written: false,
    ok_count: pages.filter(page => page.ok).length, issue_count: pages.filter(page => !page.ok).length, pages,
    next: pages.every(page => page.ok) ? "Submit the same batch without --preview." : reissue
      ? "Some task inputs changed after preparation. Prepare the batch again with next_action, move finished drafts to the new task files, then preview again."
      : "Correct the listed pages, then preview or submit the batch again.",
    ...(reissue ? { next_action: { command: current.route.commands.find(item => item.command.includes(" action prepare-current "))?.command ?? "context status --format json" } } : {}) };
}
