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
