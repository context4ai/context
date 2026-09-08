import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { prepareWorkspace, assertPreparationComplete } from "../project/workspacePreparation.js";
import { runDurableMultiFileTransaction } from "../project/durableMultiFileTransaction.js";
import { durableContentDigest } from "../project/durableSingleFileTransaction.js";
import { withProjectWriteLock } from "../project/writeLock.js";
import { resolveContextEntry } from "../project/entryCommand.js";
import { collectProjectStatus } from "../project/status.js";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { repositoryRecoveryPlan } from "../project/repoSourceRecovery.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const parent = resolve(import.meta.dir, "../../../.tmp/workspace-maintenance-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-")); roots.push(root);
  return root;
}
async function put(root: string, path: string, content = "saved") {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
const taskFile = ".tmp/context-runtime/indexer/current.json";

test("preparation removes all selected task/maintenance state and retains sources and results", async () => {
  const root = await fixture();
  const discarded = ["knowledge/decisions.json", taskFile, ".tmp/context-runtime/indexer/Z.json", ".tmp/context-runtime/indexer/a.json", ".tmp/context-runtime/maintenance/current.json", ".tmp/context-runtime/lifecycle/candidates.jsonl"];
  const kept = ["knowledge/page.md", "knowledge/structure.yaml", "sources/lark/body.md", "sources/note/n.md", "sources/sessions/s.md", "src/index.ts", ".tmp/repo/local.ts", ".tmp/work-start-report.md", "dist/page.md"];
  for (const path of [...discarded, ...kept]) await put(root, path);
  const preview = await prepareWorkspace({ projectRoot: root });
  expect(preview.action).toBe("preview");
  for (const path of discarded) expect(await readFile(join(root, path), "utf8")).toBe("saved");
  const result = await prepareWorkspace({ projectRoot: root, apply: true, plan_digest: preview.revision });
  expect(result.action).toBe("task-state-cleared");
  for (const path of discarded) expect(await Bun.file(join(root, path)).exists()).toBe(false);
  for (const path of kept) expect(await readFile(join(root, path), "utf8")).toBe("saved");
  expect(await prepareWorkspace({ projectRoot: root })).toMatchObject({ file_count: 0 });
});

test("a changed preview rejects without discarding new work", async () => {
  const root = await fixture(); await put(root, taskFile);
  const preview = await prepareWorkspace({ projectRoot: root });
  await put(root, taskFile, "changed");
  await expect(prepareWorkspace({ projectRoot: root, apply: true, plan_digest: preview.revision })).rejects.toThrow("changed");
  expect(await readFile(join(root, taskFile), "utf8")).toBe("changed");
});

test("symlinked runtime cannot escape the workspace", async () => {
  const root = await fixture(); const outside = await fixture();
  await put(outside, "keep.md"); await mkdir(join(root, ".tmp"));
  await symlink(outside, join(root, ".tmp/context-runtime"));
  await expect(prepareWorkspace({ projectRoot: root })).rejects.toThrow("symlink");
  expect(await readFile(join(outside, "keep.md"), "utf8")).toBe("saved");
});

test("another writer excludes preparation", async () => {
  const root = await fixture();
  await put(root, ".tmp/context-runtime/locks/project-write.lock/owner.json", JSON.stringify({ protocol: "context.project-write-lock.v1", pid: process.pid, operation: "author", started_at: "now" }));
  await expect(prepareWorkspace({ projectRoot: root })).rejects.toThrow("already held");
});

test("interrupted cleanup has an actionable resume and blocks production status", async () => {
  const root = await fixture(); await put(root, taskFile);
  const revision = `sha256:${"a".repeat(64)}`;
  await expect(withProjectWriteLock(root, "prepare-workspace", () => runDurableMultiFileTransaction({
    projectRoot: root, kind: "prepare-workspace", proposal_digest: revision,
    targets: [{ path: taskFile, operation: "delete", base_digest: durableContentDigest("saved"), target_digest: null }],
    inject_failure: point => { if (point.startsWith("after-target-delete:")) throw new Error("interrupted"); },
  }))).rejects.toThrow("interrupted");
  await expect(assertPreparationComplete(root)).rejects.toThrow("unfinished");
  await expect(collectProjectStatus(root)).rejects.toThrow("unfinished");
  const preview = await prepareWorkspace({ projectRoot: root });
  expect(preview.action).toBe("resume-required");
  expect(preview.next).toContain(revision);
  await prepareWorkspace({ projectRoot: root, apply: true, plan_digest: revision });
  await assertPreparationComplete(root);
  expect(await prepareWorkspace({ projectRoot: root })).toMatchObject({ file_count: 0 });
});

test("unrelated unfinished transaction cannot be silently thrown away", async () => {
  const root = await fixture(); await put(root, taskFile);
  await put(root, ".tmp/context-runtime/transactions/other.journal.json", JSON.stringify({ kind: "approve" }));
  await expect(prepareWorkspace({ projectRoot: root })).rejects.toThrow("unfinished write");
  expect(await readFile(join(root, taskFile), "utf8")).toBe("saved");
});

test("entry exposes real packaged maintenance guides without registering production", async () => {
  const root = await fixture();
  await put(root, "package.json", JSON.stringify({ context: { project: true, entry: "src/index.ts" } }));
  await put(root, "src/index.ts");
  const entry = resolveContextEntry({ cwd: root, language: "en" });
  for (const key of ["workspace_prepare", "workspace_commit", "workspace_restore"] as const) {
    expect((await readFile(entry.guidance![key].path, "utf8")).length).toBeGreaterThan(0);
  }
  expect(await prepareWorkspace({ projectRoot: root })).toMatchObject({ file_count: 0 });
});

test("Agent Git recipe commits and restores embedded workspace without unrelated staged loss", async () => {
  const root = await fixture();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  await put(root, "context/knowledge/page.md", "v1"); await put(root, "unrelated.md", "initial");
  await put(root, ".gitignore", "**/.tmp/\n");
  git("add", "."); git("commit", "-qm", "initial"); const baseline = git("rev-parse", "HEAD");
  await put(root, "unrelated.md", "staged"); git("add", "unrelated.md");
  await put(root, "context/knowledge/page.md", "v2");
  git("commit", "-qm", "workspace result", "--only", "--", "context/knowledge/page.md");
  expect(git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")).toBe("context/knowledge/page.md");
  expect(git("diff", "--cached", "--name-only")).toBe("unrelated.md");
  const head = git("rev-parse", "HEAD");
  await put(join(root, "context"), taskFile);
  const plan = await prepareWorkspace({ projectRoot: join(root, "context") });
  await prepareWorkspace({ projectRoot: join(root, "context"), apply: true, plan_digest: plan.revision });
  git("restore", `--source=${baseline}`, "--worktree", "--", "context/knowledge/page.md");
  expect(await readFile(join(root, "context/knowledge/page.md"), "utf8")).toBe("v1");
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(git("diff", "--cached", "--name-only")).toBe("unrelated.md");
  expect(git("show", ":unrelated.md")).toBe("staged");
});

test("a real lifecycle after Partition can be abandoned without losing repository readiness", async () => {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  await completePartitionStage(root);
  expect((await currentLedger(root))!.entries.length).toBeGreaterThan(0);
  const before = await readFile(join(root, "sources/repo/index.yaml"), "utf8");
  const plan = await prepareWorkspace({ projectRoot: root });
  await prepareWorkspace({ projectRoot: root, apply: true, plan_digest: plan.revision });
  expect(await currentLedger(root)).toBeUndefined();
  expect(await readFile(join(root, "sources/repo/index.yaml"), "utf8")).toBe(before);
  const sources = await repositoryRecoveryPlan({ projectRoot: root });
  expect(sources).toMatchObject({ pending_groups: 0, next_action: null });
  await collectProjectStatus(root);
  expect(await currentLedger(root)).toBeUndefined();
});
