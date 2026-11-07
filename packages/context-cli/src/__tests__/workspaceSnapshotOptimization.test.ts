import { afterEach, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectWorkspaceVersion, recordWorkspaceVersion, readWorkspaceChangelog, workspaceContentSnapshot } from "../project/workspaceChangelog.js";
import { observeWorkspaceContent } from "../project/workspaceContentSnapshot.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fields = { version: "0.1.0", title: "Guides", changes: ["Add guides"], triggers: [{ kind: "initial", description: "Request" }] };

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "context-snapshot-")); roots.push(root);
  git(root, "init", "-q"); git(root, "config", "user.name", "Example"); git(root, "config", "user.email", "author@example.test");
  await fs.mkdir(join(root, "knowledge"));
  await fs.writeFile(join(root, "package.json"), '{"version":"0.0.0"}\n');
  await fs.writeFile(join(root, "knowledge/guide.md"), "# Guide\nText\n");
  git(root, "add", "."); git(root, "commit", "-qm", "Initial");
  return root;
}

test("clean tracked bytes use Git, while dirty, flagged, deleted and untracked files remain observable", async () => {
  const root = await fixture();
  const target = join(root, "knowledge/guide.md");
  const original = fs.readFile;
  let reads = 0;
  const spy = spyOn(fs, "readFile").mockImplementation(((...args: Parameters<typeof original>) => {
    if (String(args[0]) === target) reads++;
    return original(...args);
  }) as typeof original);
  try {
    const before = await workspaceContentSnapshot(root);
    expect(before["knowledge/guide.md"]).toBe(`git-blob:${git(root, "rev-parse", ":knowledge/guide.md").trim()}`);
    expect(reads).toBe(0);
    const stamp = await fs.stat(target);
    await fs.writeFile(target, "# Guide\nNext\n"); await fs.utimes(target, stamp.atime, stamp.mtime);
    expect((await workspaceContentSnapshot(root))["knowledge/guide.md"]).not.toBe(before["knowledge/guide.md"]);
    git(root, "update-index", "--assume-unchanged", "knowledge/guide.md");
    expect((await workspaceContentSnapshot(root))["knowledge/guide.md"]).not.toBe(before["knowledge/guide.md"]);
    git(root, "update-index", "--no-assume-unchanged", "knowledge/guide.md");
    git(root, "update-index", "--skip-worktree", "knowledge/guide.md");
    expect((await workspaceContentSnapshot(root))["knowledge/guide.md"]).not.toBe(before["knowledge/guide.md"]);
    await fs.rm(target);
    expect((await workspaceContentSnapshot(root))["knowledge/guide.md"]).toBeUndefined();
    await fs.writeFile(join(root, "knowledge/new.md"), "New");
    expect((await workspaceContentSnapshot(root))["knowledge/new.md"]).toStartWith("git-blob:");
  } finally { spy.mockRestore(); }
});

test("Git conversion rules never hide changed workspace bytes", async () => {
  const root = await fixture();
  const path = join(root, "knowledge/guide.md");
  await fs.writeFile(join(root, ".gitattributes"), "*.md eol=lf\n");
  git(root, "add", "."); git(root, "commit", "-qm", "Line ending policy");
  const before = await workspaceContentSnapshot(root);
  await fs.writeFile(path, "# Guide\r\nText\r\n");
  expect((await workspaceContentSnapshot(root))["knowledge/guide.md"]).not.toBe(before["knowledge/guide.md"]);
  await fs.writeFile(join(root, ".gitattributes"), "*.md filter=strip\n");
  git(root, "config", "filter.strip.clean", "sed '/^noise:/d'");
  await fs.writeFile(path, "# Guide\nnoise:A\n"); git(root, "add", "."); git(root, "commit", "-qm", "Filter policy");
  const filtered = await workspaceContentSnapshot(root);
  await fs.writeFile(path, "# Guide\nnoise:B\n");
  expect(git(root, "diff", "--name-only")).toBe("");
  expect((await workspaceContentSnapshot(root))["knowledge/guide.md"]).not.toBe(filtered["knowledge/guide.md"]);
  await fs.rm(join(root, ".gitattributes")); git(root, "config", "core.autocrlf", "true");
  await fs.writeFile(path, "# Guide\nText\n"); git(root, "add", "."); git(root, "commit", "-qm", "Auto line endings");
  const automatic = await workspaceContentSnapshot(root);
  await fs.writeFile(path, "# Guide\r\nText\r\n");
  expect((await workspaceContentSnapshot(root))["knowledge/guide.md"]).not.toBe(automatic["knowledge/guide.md"]);
});

test("subdirectory snapshots detect edits and keep symlinks and ignored scratch outside content", async () => {
  const root = await fixture();
  await fs.symlink("guide.md", join(root, "knowledge/link.md")); git(root, "add", "."); git(root, "commit", "-qm", "Link");
  const sub = join(root, "knowledge");
  const before = await workspaceContentSnapshot(sub);
  expect(before["link.md"]).toBeUndefined();
  await fs.writeFile(join(sub, "guide.md"), "Changed");
  expect((await workspaceContentSnapshot(sub))["guide.md"]).not.toBe(before["guide.md"]);
  await fs.writeFile(join(root, "PLAN-task.md"), "Planning");
  await fs.writeFile(join(sub, ".DS_Store"), "Finder");
  expect(Object.keys(await workspaceContentSnapshot(root))).not.toContain("PLAN-task.md");
  expect(Object.keys(await workspaceContentSnapshot(root))).not.toContain("knowledge/.DS_Store");
});

test("verified migration remembers failures but recovers after restoring old excluded files", async () => {
  const root = await fixture();
  await recordWorkspaceVersion(root, { ...fields, expected_digest: (await inspectWorkspaceVersion(root)).expected_digest });
  const checkpoint = join(root, ".tmp/context-runtime/version-checkpoint.json");
  const legacy = { version: fields.version, digest: digest((await observeWorkspaceContent(root, { legacy: true, raw: true })).files) };
  await fs.writeFile(checkpoint, JSON.stringify(legacy));
  await fs.writeFile(join(root, "PLAN-next.md"), "Plan");
  expect((await inspectWorkspaceVersion(root)).changed).toBe(true);
  const failed = JSON.parse(await fs.readFile(checkpoint, "utf8"));
  expect(failed.digest).toBe(legacy.digest); expect(typeof failed.checked).toBe("string");
  await fs.rm(join(root, "PLAN-next.md"));
  expect((await inspectWorkspaceVersion(root)).current).toBe(true);
  expect(JSON.parse(await fs.readFile(checkpoint, "utf8")).format).toBe("git-blob-v1");
  await fs.writeFile(join(root, "PLAN-next.md"), "New plan after migration");
  expect((await inspectWorkspaceVersion(root)).current).toBe(true);
});

test("replay is write-free; description-only updates preserve checkpoint and version, including tagged replay", async () => {
  const root = await fixture();
  const input = { ...fields, expected_digest: (await inspectWorkspaceVersion(root)).expected_digest };
  await recordWorkspaceVersion(root, input);
  const paths = ["package.json", "changelog.yaml", "CHANGELOG.md", ".tmp/context-runtime/version-checkpoint.json"] as const;
  const before = await Promise.all(paths.map(path => fs.readFile(join(root, path), "utf8")));
  expect((await recordWorkspaceVersion(root, input)).outcome).toBe("already-recorded");
  expect(await Promise.all(paths.map(path => fs.readFile(join(root, path), "utf8")))).toEqual(before);
  const corrected = { ...input, title: "Corrected guide", changes: ["Add the guide"] };
  expect((await recordWorkspaceVersion(root, corrected)).outcome).toBe("description-updated");
  expect(await fs.readFile(join(root, paths[0]!), "utf8")).toBe(before[0]!);
  expect(await fs.readFile(join(root, paths[3]!), "utf8")).toBe(before[3]!);
  expect((await readWorkspaceChangelog(root))[0]?.actor?.name).toBe("Example");
  git(root, "tag", `v${fields.version}`);
  expect((await recordWorkspaceVersion(root, corrected)).outcome).toBe("already-recorded");
  await expect(recordWorkspaceVersion(root, input)).rejects.toThrow("tagged");
  await fs.writeFile(join(root, "knowledge/guide.md"), "Actual content change");
  await expect(recordWorkspaceVersion(root, corrected)).rejects.toThrow("diff changed");
});


test("normal version recording retires its format-only baseline; description updates preserve it", async () => {
  const root = await fixture();
  const baseline = join(root, ".tmp/context-runtime/format-only-update.json");
  await fs.mkdir(join(root, ".tmp/context-runtime"), { recursive: true });
  await fs.writeFile(baseline, "old baseline");
  await recordWorkspaceVersion(root, { ...fields, expected_digest: (await inspectWorkspaceVersion(root)).expected_digest });
  expect(await fs.stat(baseline).catch(() => null)).toBeNull();
  await fs.writeFile(baseline, "new capture baseline");
  await recordWorkspaceVersion(root, { ...fields, title: "Corrected title", expected_digest: "description-only" });
  expect(await fs.readFile(baseline, "utf8")).toBe("new capture baseline");
});

test("SHA-256 subdirectory snapshots preserve raw bytes under inherited attributes, index flags and file type changes", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "context-sha256-snapshot-")); roots.push(root);
  git(root, "init", "-q", "--object-format=sha256");
  git(root, "config", "user.name", "Example"); git(root, "config", "user.email", "author@example.test");
  const sub = join(root, "workspace"); await fs.mkdir(sub);
  await fs.writeFile(join(root, ".gitattributes"), "*.txt text eol=lf\n");
  await fs.writeFile(join(root, "outside.txt"), "Outside the workspace");
  await fs.writeFile(join(sub, "plain.bin"), Buffer.from([0, 1, 128, 255]));
  await fs.writeFile(join(sub, "converted.txt"), "First\nSecond\n");
  await fs.symlink("../outside.txt", join(sub, "link"));
  git(root, "add", "."); git(root, "commit", "-qm", "SHA-256 fixture");
  const rawBlob = async (path: string) => `git-blob:${execFileSync("git", ["hash-object", "--no-filters", "--stdin"], {
    cwd: root, input: await fs.readFile(join(sub, path)), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim()}`;
  const initial = await observeWorkspaceContent(sub);
  expect(initial.format).toBe("git-blob-v1");
  expect(initial.files["plain.bin"]).toBe(`git-blob:${git(root, "rev-parse", ":workspace/plain.bin").trim()}`);
  expect(initial.files["plain.bin"]).toMatch(/^git-blob:[a-f0-9]{64}$/u);
  expect(initial.files["link"]).toBeUndefined();
  for (const [flag, bytes] of [["assume-unchanged", [0, 2, 128, 255]], ["skip-worktree", [0, 3, 128, 255]]] as const) {
    git(root, "update-index", `--${flag}`, "workspace/plain.bin");
    await fs.writeFile(join(sub, "plain.bin"), Buffer.from(bytes));
    expect((await workspaceContentSnapshot(sub))["plain.bin"]).toBe(await rawBlob("plain.bin"));
    expect((await workspaceContentSnapshot(sub))["plain.bin"]).not.toBe(initial.files["plain.bin"]);
    git(root, "update-index", `--no-${flag}`, "workspace/plain.bin");
  }
  await fs.writeFile(join(sub, "converted.txt"), "First\r\nSecond\r\n");
  expect(git(root, "diff", "--name-only", "--", "workspace/converted.txt")).toBe("");
  const converted = await workspaceContentSnapshot(sub);
  expect(converted["converted.txt"]).toBe(await rawBlob("converted.txt"));
  expect(converted["converted.txt"]).not.toBe(initial.files["converted.txt"]);
  await fs.rm(join(sub, "plain.bin")); await fs.symlink("../outside.txt", join(sub, "plain.bin"));
  await fs.rm(join(sub, "link")); await fs.writeFile(join(sub, "link"), "Now an ordinary file");
  const typesChanged = await workspaceContentSnapshot(sub);
  expect(typesChanged["plain.bin"]).toBeUndefined();
  expect(typesChanged["link"]).toBe(await rawBlob("link"));
  // Git accepts boolean aliases too; they still enable checkout conversion.
  for (const alias of ["yes", "on", "1"]) {
    git(root, "config", "core.autocrlf", alias);
    await fs.writeFile(join(sub, "automatic.md"), "First\nSecond\n");
    git(root, "add", "workspace/automatic.md");
    await fs.rm(join(sub, "automatic.md"));
    git(root, "checkout", "--", "workspace/automatic.md");
    expect(await fs.readFile(join(sub, "automatic.md"), "utf8")).toBe("First\r\nSecond\r\n");
    expect(git(root, "diff", "--name-only", "--", "workspace/automatic.md")).toBe("");
    expect(git(root, "diff-files", "--name-only", "--", "workspace/automatic.md")).toBe("");
    expect((await workspaceContentSnapshot(sub))["automatic.md"]).toBe(await rawBlob("automatic.md"));
  }
});

test("legacy crlf normalization cannot conceal changed workspace line endings", async () => {
  const root = await fixture();
  await fs.writeFile(join(root, ".gitattributes"), "*.md crlf\n");
  git(root, "config", "core.autocrlf", "false"); git(root, "add", "."); git(root, "commit", "-qm", "Legacy line endings");
  const before = await workspaceContentSnapshot(root);
  await fs.writeFile(join(root, "knowledge/guide.md"), "# Guide\r\nText\r\n");
  git(root, "add", "knowledge/guide.md");
  expect(git(root, "diff-files", "--name-only").trim()).toBe("");
  expect((await workspaceContentSnapshot(root))["knowledge/guide.md"]).not.toBe(before["knowledge/guide.md"]);
});

test("a verified raw-byte checkpoint migrates back to Git without recording a version", async () => {
  const root = await fixture();
  await recordWorkspaceVersion(root, { ...fields, expected_digest: (await inspectWorkspaceVersion(root)).expected_digest });
  const raw = await observeWorkspaceContent(root, { raw: true });
  await fs.writeFile(join(root, ".tmp/context-runtime/version-checkpoint.json"), JSON.stringify({ version: "0.1.0", digest: digest(raw.files), format: "sha256-v1" }));
  expect(await inspectWorkspaceVersion(root)).toMatchObject({ current: true, changed: false, snapshot_format: "git-blob-v1" });
  await fs.writeFile(join(root, "knowledge/guide.md"), "Changed\n");
  expect((await inspectWorkspaceVersion(root)).changed).toBe(true);
});
