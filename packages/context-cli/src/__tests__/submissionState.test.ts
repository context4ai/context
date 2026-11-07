import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContextError } from "../lib/errors.js";
import { markSubmissionState, withSubmissionState } from "../project/submissionState.js";
import { runDurableMultiFileTransaction, recoverDurableMultiFileTransactions } from "../project/durableMultiFileTransaction.js";
import { durableContentDigest, runDurableSingleFileTransaction, recoverDurableSingleFileTransaction } from "../project/durableSingleFileTransaction.js";
import { recoverTaskTransactions } from "../project/taskRecovery.js";
import { prepareActionCompletionOutput } from "../project/actionCompletionOutput.js";
import { saveProductionStage, productionStageDirectory } from "../project/productionStageStore.js";
import { validateProductionStage } from "../project/productionStage.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "context-submission-state-")); roots.push(root);
  await writeFile(join(root, "guide.md"), "Before");
  return root;
}
async function failure(work: () => Promise<unknown>) {
  try { await withSubmissionState(work); } catch (error) {
    expect(error).toBeInstanceOf(ContextError);
    return error as ContextError;
  }
  throw new Error("Expected submission failure");
}
function multi(projectRoot: string, point?: string, base = "Before") {
  return runDurableMultiFileTransaction({ projectRoot, kind: "test-submission", proposal_digest: durableContentDigest("proposal"),
    targets: [{ path: "guide.md", operation: "write", base_digest: durableContentDigest(base), target_digest: durableContentDigest("After"), content: "After" }],
    inject_failure: current => { if (current === point) throw new Error("Interrupted write"); } });
}

test("preflight rejection is not committed; journal interruption is uncertain and recovery preserves bytes", async () => {
  const root = await fixture();
  const rejected = await failure(() => multi(root, undefined, "Stale"));
  expect(rejected.detail?.submission_state).toBe("not-committed");
  expect(await readFile(join(root, "guide.md"), "utf8")).toBe("Before");
  const interrupted = await failure(() => multi(root, "after-target-rename:guide.md"));
  expect(interrupted.detail?.submission_state).toBe("uncertain");
  expect(interrupted.detail?.next_action).toMatchObject({ command: "context task recover --operation transactions --format json" });
  await recoverDurableMultiFileTransactions(root);
  expect(await readFile(join(root, "guide.md"), "utf8")).toBe("After");
});

test("post-commit exceptions, including journal cleanup sync failure, never recommend resubmission", async () => {
  for (const point of ["after-transaction-remove", "after-transaction-remove-dir-fsync", undefined]) {
    const root = await fixture();
    const error = await failure(async () => { await multi(root, point); throw new Error("Next preparation failed"); });
    expect(error.detail?.submission_state).toBe("committed");
    expect(error.detail?.next_action).toMatchObject({ command: "context status --format json" });
    expect(await readFile(join(root, "guide.md"), "utf8")).toBe("After");
  }
});

test("single-file journal interruption and completed cleanup retain their distinct states", async () => {
  for (const point of ["after-target-rename", "after-journal-remove"] as const) {
    const root = await fixture();
    const error = await failure(() => runDurableSingleFileTransaction({ projectRoot: root, kind: "test-single", target_path: "guide.md",
      expected_base_digest: durableContentDigest("Before"), target_content: "After",
      inject_failure: current => { if (current === point) throw new Error("Interrupted single file"); } }));
    expect(error.detail?.submission_state).toBe(point === "after-target-rename" ? "uncertain" : "committed");
    await recoverDurableSingleFileTransaction({ projectRoot: root, kind: "test-single" });
    expect(await readFile(join(root, "guide.md"), "utf8")).toBe("After");
  }
});

test("an authoritative atomic manifest stays committed when its navigation pointer cannot be saved", async () => {
  const root = await fixture();
  const stage = validateProductionStage({ id: "stage-1", purpose: "Document behavior", scopes: [], tasks: [], pending_scopes: [], report_approved: true });
  await mkdir(join(root, ".tmp/context-runtime/production-stages/current.json"), { recursive: true });
  const error = await failure(() => saveProductionStage(root, stage));
  expect(error.detail?.submission_state).toBe("committed");
  expect(JSON.parse(await readFile(join(root, productionStageDirectory(stage.id), "manifest.json"), "utf8")).report_approved).toBe(true);
});

test("nested command and business boundaries preserve state without leaking to the next command", async () => {
  const root = await fixture();
  const result = await withSubmissionState(() => withSubmissionState(async () => { await multi(root); return { outcome: "accepted" }; }));
  expect(result).toMatchObject({ submission_state: "committed" });
  expect((await failure(async () => { throw new Error("Rejected input"); })).detail?.submission_state).toBe("not-committed");
});

test("both bounded completion formats retain committed status and next preparation recovery", async () => {
  const root = await fixture();
  for (const production of [true, false]) {
    const result = { ...(production ? { stage_state: "active", accepted: [{ task: "one", receipt: "receipt" }], failed: [] } : { outcome: "accepted", outcomes: [] }),
      submission_state: "committed", diagnostic: "x".repeat(20_000), next_preparation: { outcome: "failed", message: "Next unavailable", command: "context status --format json" } };
    const summary = await prepareActionCompletionOutput({ projectRoot: root, result, format: "json" });
    expect(summary).toMatchObject({ submission_state: "committed", next_preparation: { outcome: "failed", command: "context status --format json" } });
  }
});


test("the advertised transaction command previews and recovers a single-file journal", async () => {
  const root = await fixture();
  await failure(() => runDurableSingleFileTransaction({ projectRoot: root, kind: "test-single", target_path: "guide.md",
    expected_base_digest: durableContentDigest("Before"), target_content: "After",
    inject_failure: point => { if (point === "after-journal-dir-fsync") throw new Error("Interrupted before target"); } }));
  const plan = await recoverTaskTransactions({ projectRoot: root });
  expect(plan.affected_files).toEqual([{ path: "guide.md", operation: "write" }]);
  expect(await readFile(join(root, "guide.md"), "utf8")).toBe("Before");
  const result = await recoverTaskTransactions({ projectRoot: root, apply: true, plan_digest: plan.revision! });
  expect(result.receipts).toHaveLength(1);
  expect(await readFile(join(root, "guide.md"), "utf8")).toBe("After");
});

test("per-item observations do not inherit committed state from a previous batch item", async () => {
  const root = await fixture();
  await withSubmissionState(async () => {
    await multi(root);
    await expect(withSubmissionState(async () => { throw new Error("Second input rejected"); }, { fresh: true }))
      .rejects.toMatchObject({ detail: { submission_state: "not-committed" } });
    await writeFile(join(root, "guide.md"), "Before");
    await expect(withSubmissionState(() => multi(root, "after-target-rename:guide.md"), { fresh: true }))
      .rejects.toMatchObject({ detail: { submission_state: "uncertain" } });
  });
});

 test.each(["not-committed", "committed", "uncertain"] as const)("managed submission errors retain their authority after %s", async state => {
  await expect(withSubmissionState(async () => {
    markSubmissionState(state);
    throw new TypeError("Invalid submission input");
  }, { managed: true })).rejects.toMatchObject({ detail: { submission_state: state,
    next_action: { command: state === "uncertain" ? "context task recover --operation transactions --managed --format json" : "context status --managed --format json" } } });
});
