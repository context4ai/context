import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { GitProgressError, runGitWithProgress } from "../lib/gitProgress.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
/** A stand-in git: prints `steps` progress lines `delay` ms apart, optionally repeating one line. */
async function fakeGit(script: string) {
  // Package-local: some environments mount the system temp directory noexec.
  await mkdir(resolve(".tmp"), { recursive: true });
  const root = await mkdtemp(join(resolve(".tmp"), "git-progress-")); roots.push(root);
  const bin = join(root, "git");
  await writeFile(bin, `#!/usr/bin/env node\nconst args = process.argv.slice(2);\n${script}\n`);
  await chmod(bin, 0o755);
  return bin;
}

test("a slow fetch that keeps progressing finishes; stdout stays clean", async () => {
  const bin = await fakeGit(`if (!args.includes("--progress")) process.exit(9);
let i = 0; const t = setInterval(() => { process.stderr.write("Receiving objects: " + (++i) + "% (" + i + "/10)\\r");
  if (i === 10) { clearInterval(t); process.stdout.write("done\\n"); } }, 150);`);
  expect(await runGitWithProgress(["fetch", "origin"], { bin, label: "git fetch", idleMs: 500, limitMs: 10_000 })).toBe("done\n");
});

test("repeating the same line is not progress", async () => {
  const bin = await fakeGit(`setInterval(() => process.stderr.write("Receiving objects: 40% (4/10)\\r"), 100);`);
  const error = await runGitWithProgress(["fetch", "origin"], { bin, label: "git fetch", idleMs: 600, limitMs: 10_000 }).catch(value => value);
  expect(error).toBeInstanceOf(GitProgressError);
  expect(error.kind).toBe("no-progress");
  expect(error.message).toContain("Receiving objects: 40% (4/10)");
});

test("a large object still downloading is progress, though the object count stays", async () => {
  const bin = await fakeGit(`let i = 0; const t = setInterval(() => { process.stderr.write("Receiving objects:  40% (4/10), " + (++i * 0.5).toFixed(2) + " MiB | 1.00 MiB/s\\r");
  if (i === 12) { clearInterval(t); process.stdout.write("done\\n"); } }, 100);`);
  expect(await runGitWithProgress(["fetch", "origin"], { bin, label: "git fetch", idleMs: 400, limitMs: 10_000 })).toBe("done\n");
});

test("warnings between unchanged progress lines are not progress", async () => {
  const bin = await fakeGit(`let i = 0; setInterval(() => process.stderr.write(++i % 2 ? "Receiving objects: 40% (4/10)\\r" : "warning: retry 1\\n"), 100);`);
  const error = await runGitWithProgress(["fetch", "origin"], { bin, label: "git fetch", idleMs: 600, limitMs: 3_000 }).catch(value => value);
  expect(error.kind).toBe("no-progress");
});

test("the total limit is reported separately from no progress, without credentials", async () => {
  const bin = await fakeGit(`let i = 0; setInterval(() => process.stderr.write("Receiving objects: " + (++i) + " from https://user:secret@example.test/r.git\\r"), 100);`);
  const error = await runGitWithProgress(["clone", "https://user:secret@example.test/r.git", "x"], { bin, label: "git clone", idleMs: 5_000, limitMs: 800 }).catch(value => value);
  expect(error.kind).toBe("too-long");
  expect(error.message).toContain("Report this to the user");
  expect(error.message).not.toContain("secret");
});

test("a failing command reports git's error line without credentials", async () => {
  const bin = await fakeGit(`process.stderr.write("fatal: could not read from https://token@example.test/r.git\\n"); process.exit(128);`);
  const error = await runGitWithProgress(["fetch", "origin"], { bin, label: "git fetch" }).catch(value => value);
  expect(error.kind).toBe("failed");
  expect(error.message).toBe("git fetch failed: fatal: could not read from https://example.test/r.git");
});
