import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRepoSource, ensureRepoSources } from "../project/repoSources.js";

test("explicit local scope replaces an old subpath while ref-only updates retain it", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-source-rescope-"));
  const repository = join(root, "repository");
  const packageRoot = join(repository, "packages", "sample");
  const projectRoot = join(root, "workspace");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
  try {
    await mkdir(packageRoot, { recursive: true });
    await mkdir(projectRoot);
    await writeFile(join(packageRoot, "index.ts"), "export const value = 1;\n");
    git("init", "-q");
    git("add", "--", "packages/sample/index.ts");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
    const ref = git("rev-parse", "HEAD");
    const input = { projectRoot, namespace: "20260905", module: "sample", remote: "file:///example/repository", ref };
    const link = join(projectRoot, "sources", "repo", "20260905", "sample");
    const scoped = await addRepoSource({ ...input, local: packageRoot });
    expect(scoped.source.subpath).toBe("packages/sample");
    expect(scoped.status.ready).toBe(true);
    expect((await addRepoSource(input)).source.subpath).toBe("packages/sample");

    const unscoped = await addRepoSource({ ...input, local: repository });
    expect(unscoped.source.subpath).toBeUndefined();
    expect(unscoped.status.ready).toBe(true);
    expect(unscoped.status.pinnedScopeHash).toBe(git("rev-parse", `${ref}^{tree}`));
    expect(await realpath(link)).toBe(await realpath(repository));
    expect(await readFile(join(projectRoot, "sources/repo/index.yaml"), "utf8")).not.toContain("subpath:");
    expect((await ensureRepoSources({ projectRoot }))[0]?.ready).toBe(true);

    const scopedAgain = await addRepoSource({ ...input, local: packageRoot });
    expect(scopedAgain.source.subpath).toBe("packages/sample");
    expect(scopedAgain.status.ready).toBe(true);
    expect(await realpath(link)).toBe(await realpath(packageRoot));
    expect((await addRepoSource(input)).source.subpath).toBe("packages/sample");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
