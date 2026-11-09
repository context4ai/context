import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { prepareApprovedRevision, readApprovedRevision } from "../project/approvedRevision.js";
import { prepareApprovedRevisionSubmission } from "../project/approvedRevisionSubmission.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { withCommandReadCache } from "../project/commandReadCache.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await initialRevisionKnowledge(roots);
  const prepared = await prepareApprovedRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Clarify the answer",
    pending_targets: [{ path: "architecture/usage.md", instruction: "Clarify usage" }] });
  const batch = await prepareApprovedRevisionSubmission({ projectRoot: root, revision: prepared.revision, managed: true });
  expect(batch.next_action.command).toContain("--managed");
  expect(batch.next_action.instruction).toContain("--preview");
  for (const [index, task] of batch.tasks.entries()) {
    const request = JSON.parse(await readFile(join(root, task.task_input), "utf8"));
    await writeFile(join(root, batch.agent_directory, batch.submission.tasks[index]!.edits), JSON.stringify({ stage: "approved-revision",
      markdown: request.target.markdown.replace("value 42.", "value 42. Read the exported constant directly.") }));
  }
  return { root, batch, revision: prepared.revision };
}

test("batch issues real future inputs, submits once per page, pauses for Review and rejects replay", async () => {
  const { root, batch, revision } = await fixture();
  const result = await withCommandReadCache(() => completeCurrentIndexerAction({ cwd: root, revision, value: batch.submission, managed: true }));
  expect(result).toMatchObject({ outcome: "accepted", submission_state: "committed", progress: { accepted: 2, pending: 0 },
    workflow: { current: { node: "review-current-batch" } } });
  expect(await readCandidateRecords(root)).toHaveLength(2);
  const replay = await completeCurrentIndexerAction({ cwd: root, revision, value: batch.submission, managed: true });
  expect(replay).toMatchObject({ outcome: "paused", submission_state: "not-committed", progress: { accepted: 0 } });
  expect(await readCandidateRecords(root)).toHaveLength(2);
}, 120000);

test("invalid second page keeps the first transaction and resumes only the unfinished suffix", async () => {
  const { root, batch, revision } = await fixture();
  const second = join(root, batch.agent_directory, batch.submission.tasks[1]!.edits);
  const valid = await readFile(second, "utf8");
  await writeFile(second, JSON.stringify({ stage: "approved-revision", markdown: "No metadata or sections" }));
  const result = await completeCurrentIndexerAction({ cwd: root, revision, value: batch.submission, managed: true });
  expect(result).toMatchObject({ outcome: "paused", submission_state: "committed", progress: { accepted: 1, pending: 1 },
    outcomes: [{ committed: true }, { committed: false, submission_state: "not-committed" }] });
  expect(await readCandidateRecords(root)).toHaveLength(1);
  await writeFile(second, valid);
  const current = (await readApprovedRevision(root))!;
  const resumed = await completeCurrentIndexerAction({ cwd: root, revision: current.revision,
    value: { ...batch.submission, tasks: batch.submission.tasks.slice(1) }, managed: true });
  expect(resumed).toMatchObject({ outcome: "accepted", progress: { accepted: 1 } });
  expect(await readCandidateRecords(root)).toHaveLength(2);
}, 120000);

test("all file paths are checked before any commit and changed inputs invalidate prepared drafts", async () => {
  const { root, batch, revision } = await fixture();
  const invalid = structuredClone(batch.submission);
  invalid.tasks[1]!.edits = "../outside.json";
  await expect(completeCurrentIndexerAction({ cwd: root, revision, value: invalid, managed: true })).rejects.toThrow();
  expect(await readCandidateRecords(root)).toHaveLength(0);
  await writeFile(join(root, "src/index.ts"), (await readFile(join(root, "src/index.ts"), "utf8")) + "\n// Input changed\n");
  const result = await completeCurrentIndexerAction({ cwd: root, revision, value: batch.submission, managed: true });
  expect(result).toMatchObject({ outcome: "paused", submission_state: "not-committed", progress: { accepted: 0 } });
  expect(await readCandidateRecords(root)).toHaveLength(0);
}, 120000);

test.each(["instruction", "body", "source"] as const)("a %s change between pages stops the unfinished suffix", async change => {
  const { root, batch, revision } = await fixture();
  await completeCurrentIndexerAction({ cwd: root, revision, value: { ...batch.submission, tasks: batch.submission.tasks.slice(0, 1) }, managed: true });
  const current = (await readApprovedRevision(root))!;
  if (change === "instruction") await prepareApprovedRevision({ projectRoot: root, replace_current: true, selector: current.target.path,
    instruction: "Explain different behavior", batch_candidates: current.batch_candidates! });
  else {
    const path = join(root, change === "body" ? `knowledge/${current.target.path}` : "src/indexers.yaml");
    await writeFile(path, (await readFile(path, "utf8")) + "\n# Changed input\n");
  }
  const result = await completeCurrentIndexerAction({ cwd: root, revision: current.revision,
    value: { ...batch.submission, tasks: batch.submission.tasks.slice(1) }, managed: true });
  expect(result).toMatchObject({ outcome: "paused", submission_state: "not-committed", progress: { accepted: 0 } });
  expect(await readCandidateRecords(root)).toHaveLength(1);
  const { withProjectWriteLock } = await import("../project/writeLock.js");
  expect(await withProjectWriteLock(root, "test-lock-released", async () => true)).toBe(true);
}, 120000);

test("Node artifact prepares and consumes the same tasks transport", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { resolve } = await import("node:path");
  const execute = promisify(execFile);
  const { root, revision } = await fixture();
  const cli = resolve(import.meta.dir, "../../dist/cli.js");
  const options = { cwd: root, env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, maxBuffer: 8 * 1024 * 1024, timeout: 60000 };
  const prepared = JSON.parse((await execute("node", [cli, "action", "prepare-current", "--managed", "--revision", revision], options)).stdout);
  for (const task of prepared.tasks) {
    const request = JSON.parse(await readFile(join(root, task.task_input), "utf8"));
    await writeFile(join(root, prepared.agent_directory, `${task.task}.edits.json`), JSON.stringify({ stage: "approved-revision",
      markdown: request.target.markdown.replace("value 42.", "value 42. Use this constant.") }));
  }
  const manifest = join(root, prepared.agent_directory, "submission.json");
  await writeFile(manifest, JSON.stringify(prepared.submission));
  const result = JSON.parse((await execute("node", [cli, "action", "complete-current", "--managed", "--revision", revision, "--input", manifest], options)).stdout);
  expect(result).toMatchObject({ outcome: "accepted", committed_count: 2, details_required: false });
  expect(await readCandidateRecords(root)).toHaveLength(2);
}, 120000);

test("an out-of-scope citation offers correcting it or adjusting scope; full acceptance is not reported as paused", async () => {
  const { root, batch, revision } = await fixture();
  const second = join(root, batch.agent_directory, batch.submission.tasks[1]!.edits);
  const request = JSON.parse(await readFile(join(root, batch.tasks[1]!.task_input), "utf8"));
  const sectionId = /<!-- context:section id="([^"]+)"/u.exec(request.target.markdown)![1]!;
  await writeFile(second, JSON.stringify({ stage: "approved-revision", sections: [{ section_id: sectionId,
    references: [{ source_ref: "note:elsewhere.md", locator: { path: "elsewhere.md", start_line: 1, end_line: 1 } }] }] }));
  const { CONTEXT_WORKFLOW_AUTHORITIES } = await import("../project/workflow/workflowTypes.js");
  const result = await completeCurrentIndexerAction({ cwd: root, revision, value: batch.submission, managed: true,
    authorities: [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead] }) as unknown as
    { next_preparation: { command: string; choices: Array<{ action: string; command: string }> } };
  expect(result).toMatchObject({ outcome: "paused", progress: { accepted: 1, pending: 1 } });
  expect(result.next_preparation.choices.map((choice: { action: string }) => choice.action)).toEqual(["correct-reference", "adjust-scope"]);
  expect(result.next_preparation.command).toContain("--managed");
  // Every returned command keeps the session's managed mode and explicit authority.
  for (const command of [result.next_preparation.command, ...result.next_preparation.choices.map(choice => choice.command)]) {
    expect(command).toContain("--workflow-authority");
    expect(command).toMatch(/--managed|--workflow-managed/u);
  }

  const fresh = await fixture();
  const accepted = await completeCurrentIndexerAction({ cwd: fresh.root, revision: fresh.revision, value: fresh.batch.submission, managed: true }) as unknown as
    { outcome: string; next_preparation?: { outcome: string } };
  expect(accepted.outcome).toBe("accepted");
  expect(accepted.next_preparation?.outcome).not.toBe("paused");
}, 180000);

type BatchPreview = { pages: Array<{ changed: boolean; issues: Array<{ message: string; reason_code?: string }> }> };
test("the compact batch summary keeps each page's removed citations", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { resolve } = await import("node:path");
  const execute = promisify(execFile);
  const { root, revision } = await fixture();
  const cli = resolve(import.meta.dir, "../../dist/cli.js");
  const options = { cwd: root, env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, maxBuffer: 8 * 1024 * 1024, timeout: 60000 };
  const prepared = JSON.parse((await execute("node", [cli, "action", "prepare-current", "--managed", "--revision", revision], options)).stdout);
  const removed = [];
  for (const [index, task] of prepared.tasks.entries()) {
    const request = JSON.parse(await readFile(join(root, task.task_input), "utf8"));
    const section = request.target.sections[0];
    // The first page drops its only citation; the second keeps its own.
    if (index === 0) removed.push({ section_id: section.id, source_ref: section.references[0].source_ref, path: section.references[0].locator.path,
      start_line: section.references[0].locator.start_line, end_line: section.references[0].locator.end_line });
    await writeFile(join(root, prepared.agent_directory, `${task.task}.edits.json`), JSON.stringify(index === 0
      ? { stage: "approved-revision", sections: [{ section_id: section.id, references: [] }] }
      : { stage: "approved-revision", markdown: request.target.markdown.replace("value 42.", "value 42. Use this constant.") }));
  }
  const manifest = join(root, prepared.agent_directory, "submission.json");
  await writeFile(manifest, JSON.stringify(prepared.submission));
  const args = [cli, "action", "complete-current", "--managed", "--revision", revision, "--input", manifest];
  const preview = JSON.parse((await execute("node", [...args, "--preview"], options)).stdout);
  expect(preview.pages[0].removed_citations).toEqual(removed);
  expect(preview.pages[1].removed_citations ?? []).toEqual([]);
  const summary = JSON.parse((await execute("node", args, options)).stdout);
  expect(summary).toMatchObject({ outcome: "accepted", committed_count: 2 });
  expect(summary.outcomes[0].removed_citations).toEqual(removed);
  expect(summary.outcomes[1]).not.toHaveProperty("removed_citations");
  expect(summary.removed_citations_note).toContain("repeat each with its earlier lines");
}, 120000);

test("batch preview checks every issued page with submission rules and writes nothing", async () => {
  const { root, batch, revision } = await fixture();
  const { readdir } = await import("node:fs/promises");
  const listing = async () => (await readdir(join(root, ".tmp"), { recursive: true })).sort();
  const before = await listing();
  const clean = await completeCurrentIndexerAction({ cwd: root, revision, value: batch.submission, managed: true, preview: true }) as unknown as BatchPreview;
  expect(clean).toMatchObject({ protocol: "context.approved-revision-batch-preview/v1", written: false, ok_count: 2, issue_count: 0 });
  expect(clean.pages.map((page: { changed: boolean }) => page.changed)).toEqual([true, true]);
  const first = join(root, batch.agent_directory, batch.submission.tasks[0]!.edits);
  const second = join(root, batch.agent_directory, batch.submission.tasks[1]!.edits);
  const sectionOf = async (index: number) => /<!-- context:section id="([^"]+)"/u.exec(JSON.parse(await readFile(join(root, batch.tasks[index]!.task_input), "utf8")).target.markdown)![1]!;
  const request = JSON.parse(await readFile(join(root, batch.tasks[0]!.task_input), "utf8"));
  const sourceRef = request.target.source_refs[0];
  const path = request.target.sections[0].references[0].locator.path;
  await writeFile(first, JSON.stringify({ stage: "approved-revision", sections: [{ section_id: await sectionOf(0),
    references: [{ source_ref: sourceRef, locator: { path, start_line: 9000, end_line: 9001 } },
      { source_ref: sourceRef, locator: { path, quote: "text that is not in the source" } }] }] }));
  await writeFile(second, JSON.stringify({ stage: "approved-revision", sections: [{ section_id: await sectionOf(1),
    references: [{ source_ref: "note:elsewhere.md", locator: { path: "elsewhere.md", start_line: 1, end_line: 1 } }] }] }));
  const flagged = await completeCurrentIndexerAction({ cwd: root, revision, value: batch.submission, managed: true, preview: true }) as unknown as BatchPreview;
  expect(flagged).toMatchObject({ ok_count: 0, issue_count: 2 });
  expect(flagged.pages[1]!.issues[0]).toMatchObject({ reason_code: "source-outside-revision" });
  // Both problems of the first page appear in one preview.
  expect(flagged.pages[0]!.issues.map((item: { reason_code?: string; path?: unknown }) => [item.reason_code, item.path])).toEqual([
    ["locator-out-of-range", ["sections", 0, "references", 0, "locator"]], [undefined, ["sections", 0, "references", 1, "locator"]]]);
  expect(await readCandidateRecords(root)).toHaveLength(0);
  expect(await listing()).toEqual(before);
}, 120000);

test("batch preview rejects inputs that no longer match the current Route", async () => {
  const { registerKnowledgeMaintenance } = await import("../project/knowledgeMaintenance.js");
  const joined = await fixture();
  await registerKnowledgeMaintenance(joined.root, { id: "late-note", operation: "revise", targets: [{ path: "architecture/usage.md", instruction: "Also mention the note." }] });
  const afterJoin = await completeCurrentIndexerAction({ cwd: joined.root, revision: joined.revision, value: joined.batch.submission, managed: true, preview: true }) as unknown as BatchPreview & { ok_count: number };
  expect(afterJoin.ok_count).toBe(1);
  expect(afterJoin.pages[1]!.issues[0]).toMatchObject({ reason_code: "task-input-stale" });
  expect((afterJoin as unknown as { next_action: { command: string } }).next_action.command).toContain("action prepare-current");

  const changed = await fixture();
  await writeFile(join(changed.root, "src/index.ts"), (await readFile(join(changed.root, "src/index.ts"), "utf8")) + "\n// Input changed\n");
  await expect(completeCurrentIndexerAction({ cwd: changed.root, revision: changed.revision, value: changed.batch.submission, managed: true, preview: true }))
    .rejects.toMatchObject({ detail: { reason_code: "revision-batch-paused" } });

  const ended = await fixture();
  await completeCurrentIndexerAction({ cwd: ended.root, revision: ended.revision, value: ended.batch.submission, managed: true });
  await expect(completeCurrentIndexerAction({ cwd: ended.root, revision: ended.revision, value: ended.batch.submission, managed: true, preview: true }))
    .rejects.toMatchObject({ detail: { reason_code: "revision-batch-paused" } });
}, 240000);

test("a stale preview keeps explicit authority in its recovery command", async () => {
  const { CONTEXT_WORKFLOW_AUTHORITIES } = await import("../project/workflow/workflowTypes.js");
  const { root, batch, revision } = await fixture();
  await writeFile(join(root, "src/index.ts"), (await readFile(join(root, "src/index.ts"), "utf8")) + "\n// Input changed\n");
  await expect(completeCurrentIndexerAction({ cwd: root, revision, value: batch.submission, managed: true, preview: true,
    authorities: [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead] }))
    .rejects.toMatchObject({ detail: { reason_code: "revision-batch-paused", next_action: { command: expect.stringContaining("--workflow-authority") } } });
}, 120000);
