import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPinnedSource } from "../project/indexerParserSourceMaterialization.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "context-source-availability-"));
  roots.push(root);
  return root;
}

test("missing directories and broken module links expose a recovery command", async () => {
  const root = await fixture();
  const missing = join(root, "missing");
  const link = join(root, "module");
  await symlink(missing, link);
  for (const path of [missing, link]) {
    await expect(assertPinnedSource(path, "a".repeat(40))).rejects.toMatchObject({
      detail: {
        reason_code: "repository-source-directory-unavailable", cwd: path,
        next_action: { command: "context source recovery-plan --format json" },
      },
    });
  }
});

test("a file cannot stand in for a materialized repository directory", async () => {
  const root = await fixture();
  const path = join(root, "module");
  await writeFile(path, "not a directory");
  await expect(assertPinnedSource(path, "a".repeat(40))).rejects.toMatchObject({
    detail: { reason_code: "repository-source-directory-unavailable" },
  });
});

test("available sources preserve pinned-content checks and can recover a missing link", async () => {
  const root = await fixture();
  const git = (args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git(["init", "--quiet"]);
  await writeFile(join(root, "source.txt"), "original\n");
  git(["add", "source.txt"]);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "fixture"]);
  const ref = git(["rev-parse", "HEAD"]);
  const link = join(root, "module");
  await expect(assertPinnedSource(link, ref)).rejects.toMatchObject({
    detail: { reason_code: "repository-source-directory-unavailable" },
  });
  await symlink(root, link);
  await assertPinnedSource(link, ref);
  await writeFile(join(root, "source.txt"), "changed\n");
  await expect(assertPinnedSource(link, ref)).rejects.toBeInstanceOf(TypeError);
});
