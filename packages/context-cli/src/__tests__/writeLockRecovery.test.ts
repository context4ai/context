import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectWriterLock, recoverWriterLock } from "../project/writeLockRecovery.js";
import { inspectTaskRecovery } from "../project/taskRecovery.js";
import { withProjectWriteLock } from "../project/writeLock.js";

async function fixture(run: (root: string, path: string) => Promise<void>) {
  const parent = resolve(".tmp/write-lock-recovery-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-"));
  const path = join(root, ".tmp/context-runtime/locks/project-write.lock");
  await mkdir(path, { recursive: true });
  const exited = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  expect(exited.status).toBe(0);
  await writeFile(join(path, "owner.json"), JSON.stringify({ protocol: "context.project-write-lock.v1", pid: exited.pid,
    operation: "capture-lark", started_at: "2026-01-01T00:00:00Z" }));
  try { await run(root, path); } finally { await rm(root, { recursive: true, force: true }); }
}

test("orphan lock is discoverable, previewed and archived without touching accepted work", async () => {
  await fixture(async (root, path) => {
    await mkdir(join(root, "sources"));
    await writeFile(join(root, "sources/snapshot.md"), "accepted snapshot");
    const owner = await readFile(join(path, "owner.json"), "utf8");
    const report = await inspectTaskRecovery(root);
    expect(report.actions.some(action => action.operation === "writer-lock")).toBe(true);
    const preview = await recoverWriterLock({ projectRoot: root });
    expect(await readFile(join(path, "owner.json"), "utf8")).toBe(owner);
    if (!("revision" in preview)) throw new Error("Missing preview");
    const applied = await recoverWriterLock({ projectRoot: root, apply: true, plan_digest: preview.revision });
    if (!("archived_lock" in applied)) throw new Error("Missing archive");
    expect(await readFile(join(root, applied.archived_lock, "owner.json"), "utf8")).toBe(owner);
    expect(await readFile(join(root, "sources/snapshot.md"), "utf8")).toBe("accepted snapshot");
    expect(await inspectWriterLock(root)).toBeNull();
    expect(await withProjectWriteLock(root, "next", async () => "ready")).toBe("ready");
  });
});

test("running owner and changed preview cannot be released", async () => {
  await fixture(async (root, path) => {
    const preview = await inspectWriterLock(root);
    await expect(recoverWriterLock({ projectRoot: root, apply: true, plan_digest: "stale" })).rejects.toThrow("changed");
    await writeFile(join(path, "owner.json"), JSON.stringify({ protocol: "context.project-write-lock.v1", pid: process.pid }));
    await expect(recoverWriterLock({ projectRoot: root, apply: true, plan_digest: preview!.digest })).rejects.toThrow("running");
  });
});

test("corrupt owner and symlink owner are preserved", async () => {
  await fixture(async (root, path) => {
    await writeFile(join(path, "owner.json"), "invalid");
    expect((await inspectTaskRecovery(root)).findings.some(item => item.area === "writer-lock")).toBe(true);
    await expect(recoverWriterLock({ projectRoot: root })).rejects.toThrow();
    await rm(join(path, "owner.json"));
    await writeFile(join(root, "external.json"), "{}");
    await symlink(join(root, "external.json"), join(path, "owner.json"));
    await expect(recoverWriterLock({ projectRoot: root })).rejects.toThrow();
    expect(await readFile(join(root, "external.json"), "utf8")).toBe("{}");
  });
});

test("competing recoveries release the old lock at most once", async () => {
  await fixture(async (root) => {
    const preview = await inspectWriterLock(root);
    const results = await Promise.allSettled([1, 2].map(() => recoverWriterLock({ projectRoot: root, apply: true, plan_digest: preview!.digest })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await inspectWriterLock(root)).toBeNull();
  });
});

test("changed orphan identity and unexpected lock files block apply", async () => {
  await fixture(async (root, path) => {
    const old = await inspectWriterLock(root);
    const owner = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
    await writeFile(join(path, "owner.json"), JSON.stringify({ ...owner, operation: "replacement" }));
    await expect(recoverWriterLock({ projectRoot: root, apply: true, plan_digest: old!.digest })).rejects.toThrow("changed");
    const current = await inspectWriterLock(root);
    await writeFile(join(path, "unexpected"), "preserve");
    await expect(recoverWriterLock({ projectRoot: root, apply: true, plan_digest: current!.digest })).rejects.toThrow("Unexpected");
    expect(await readFile(join(path, "unexpected"), "utf8")).toBe("preserve");
  });
});
