import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { inspectWorkspaceVersion, recordWorkspaceVersion, readWorkspaceChangelog, workspaceContentSnapshot } from "../project/workspaceChangelog.js";

test("Git comparison includes untracked content and recording writes no root receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-git-version-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    git("init", "-q"); git("config", "user.name", "Author"); git("config", "user.email", "author@example.test");
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.0.0" }));
    await writeFile(join(root, "guide.md"), "Old"); git("add", "."); git("commit", "-qm", "Initial");
    await writeFile(join(root, "guide.md"), "Updated"); await writeFile(join(root, "new.md"), "New");
    const before = await inspectWorkspaceVersion(root, "HEAD");
    expect(before.updated).toContain("guide.md"); expect(before.added).toContain("new.md");
    const fields = { version: "0.1.0", title: "Knowledge update", changes: ["Update guides"], triggers: [{ kind: "module", description: "Reader request" }] };
    await recordWorkspaceVersion(root, { ...fields, base_ref: "HEAD", expected_digest: before.expected_digest });
    expect((await inspectWorkspaceVersion(root)).current).toBe(true);
    expect((await readWorkspaceChangelog(root))[0]?.actor).toEqual({ kind: "git", name: "Author" });
    await mkdir(join(root, ".tmp"), { recursive: true });
    await writeFile(join(root, ".tmp/progress"), "temporary");
    expect((await inspectWorkspaceVersion(root)).changed).toBe(false);
    await expect(recordWorkspaceVersion(root, { ...fields, expected_digest: (await inspectWorkspaceVersion(root)).expected_digest })).rejects.toThrow("No formal content");
    expect((await readdir(root)).filter(name => name.startsWith(".context-"))).toEqual([]);
    await expect(recordWorkspaceVersion(root, { ...fields, expected_digest: before.expected_digest })).rejects.toThrow("diff changed");
    await rm(join(root, ".tmp"), { recursive: true, force: true });
    expect((await inspectWorkspaceVersion(root)).current).toBe(false);
    expect((await readWorkspaceChangelog(root))[0]?.version).toBe("0.1.0");
    git("add", "package.json", "guide.md", "new.md", "changelog.yaml", "CHANGELOG.md"); git("commit", "-qm", "Deliver guides"); git("tag", "v0.1.0");
    expect((await inspectWorkspaceVersion(root)).current).toBe(true);
    await writeFile(join(root, "guide.md"), "Next update");
    const next = await inspectWorkspaceVersion(root);
    expect(next.base_ref).toBe("refs/tags/v0.1.0"); expect(next.reusable_version).toBeNull();
    await expect(recordWorkspaceVersion(root, { ...fields, expected_digest: next.expected_digest })).rejects.toThrow("greater");
    await recordWorkspaceVersion(root, { ...fields, version: "0.1.1", expected_digest: next.expected_digest });
    expect((await readWorkspaceChangelog(root)).map(e => e.version)).toEqual(["0.1.1", "0.1.0"]);
    await expect(inspectWorkspaceVersion(root, "does-not-exist")).rejects.toThrow("Unknown Git");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("no-Git preview iterations can amend without build or publication receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-no-git-version-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.0.0" }));
    await mkdir(join(root, "knowledge")); await writeFile(join(root, "knowledge/guide.md"), "Original");
    const fields = { version: "0.1.0", title: "Guide", changes: ["Guide"], triggers: [{ kind: "initial", description: "Request" }] };
    await recordWorkspaceVersion(root, { ...fields, expected_digest: (await inspectWorkspaceVersion(root)).expected_digest });
    await writeFile(join(root, "knowledge/guide.md"), "Improved");
    const next = await inspectWorkspaceVersion(root);
    expect(next.changed).toBe(true); expect(next.reusable_version).toBe("0.1.0");
    await recordWorkspaceVersion(root, { ...fields, expected_digest: next.expected_digest });
    expect((await readWorkspaceChangelog(root)).length).toBe(1);
    await writeFile(join(root, ".tmp/context-runtime/version-checkpoint.json"), "broken cache");
    expect((await inspectWorkspaceVersion(root)).current).toBe(true);
    expect(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version).toBe("0.1.0");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an independent workspace ignored by its parent Git still versions formal content, not nested Git or temporary files", async () => {
  const parent = resolve(".tmp/workspace-version-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "ignored-"));
  try {
    execFileSync("git", ["init", "-q", outer]);
    await writeFile(join(outer, ".gitignore"), "workspace/\n");
    const root = join(outer, "workspace");
    await mkdir(join(root, "knowledge"), { recursive: true });
    await mkdir(join(root, "sources/repo/sample/.git"), { recursive: true });
    await mkdir(join(root, "sources/repo/sample/.tmp"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.0.0" }));
    await writeFile(join(root, "knowledge/answer.md"), "Answer");
    await writeFile(join(root, "sources/repo/sample/source.ts"), "export const answer = 42;");
    await writeFile(join(root, "sources/repo/sample/.git/config"), "Process metadata");
    await writeFile(join(root, "sources/repo/sample/.tmp/task.md"), "Temporary task");
    expect(Object.keys(await workspaceContentSnapshot(root))).toEqual(["knowledge/answer.md", "package.json", "sources/repo/sample/source.ts"]);
    const initial = await inspectWorkspaceVersion(root);
    expect(initial.changed).toBe(true);
    await recordWorkspaceVersion(root, { expected_digest: initial.expected_digest, version: "0.0.1", title: "Initial delivery",
      changes: ["Add the answer"], triggers: [{ kind: "initial", description: "Fixture" }], actor: { kind: "user", name: "Fixture" } });
    expect((await inspectWorkspaceVersion(root)).current).toBe(true);
    await writeFile(join(root, "knowledge/answer.md"), "Corrected answer");
    expect((await inspectWorkspaceVersion(root)).changed).toBe(true);
  } finally { await rm(outer, { recursive: true, force: true }); }
});
