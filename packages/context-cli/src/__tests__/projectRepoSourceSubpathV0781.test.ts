import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRepoSource } from "../project/repoSources.js";
import { registerSourceBatch } from "../project/sourceBatchRegistration.js";

async function fixture(): Promise<{ root: string; repository: string; moduleRoot: string; projectRoot: string; ref: string }> {
  const root = await mkdtemp(join(tmpdir(), "context-source-subpath-"));
  const repository = join(root, "repository");
  const moduleRoot = join(repository, "apps", "web");
  const projectRoot = join(root, "workspace");
  await mkdir(moduleRoot, { recursive: true });
  await mkdir(projectRoot);
  await writeFile(join(moduleRoot, "index.ts"), "export const value = 1;\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
  git("init", "-q");
  git("add", "--", "apps/web/index.ts");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
  return { root, repository, moduleRoot, projectRoot, ref: git("rev-parse", "HEAD") };
}

test("subpath scopes a remote-only source and a local repository root", async () => {
  const { root, repository, moduleRoot, projectRoot, ref } = await fixture();
  try {
    const base = { projectRoot, namespace: "20261022", module: "web", remote: "file:///example/repository", ref };
    const remoteOnly = await addRepoSource({ ...base, subpath: "./apps/web/" });
    expect(remoteOnly.source.subpath).toBe("apps/web");
    expect(remoteOnly.source.local).toBeUndefined();

    const attached = await addRepoSource({ ...base, local: repository, subpath: "apps/web" });
    expect(attached.source.subpath).toBe("apps/web");
    expect(attached.status.ready).toBe(true);
    expect(await realpath(join(projectRoot, "sources/repo/20261022/web"))).toBe(await realpath(moduleRoot));

    expect((await addRepoSource({ ...base, local: moduleRoot, subpath: "apps/web" })).source.subpath).toBe("apps/web");
    expect((await addRepoSource({ ...base, subpath: "." })).source.subpath).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("subpath rejects escapes and conflicts with a local module directory", async () => {
  const { root, moduleRoot, projectRoot, ref } = await fixture();
  try {
    const base = { projectRoot, namespace: "20261022", module: "web", remote: "file:///example/repository", ref };
    await expect(addRepoSource({ ...base, subpath: "../outside" })).rejects.toThrow("inside the repository");
    await expect(addRepoSource({ ...base, subpath: "/abs/apps" })).rejects.toThrow("inside the repository");
    await expect(addRepoSource({ ...base, local: moduleRoot, subpath: "apps/api" })).rejects.toThrow("conflicts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("batch repo items accept subpath and report accepted fields for unknown ones", async () => {
  const { root, projectRoot, ref } = await fixture();
  try {
    const item = { type: "repo", module: "web", remote: "file:///example/repository", ref, subpath: "apps/web" };
    const result = await registerSourceBatch({ projectRoot, namespace: "20261022", payload: { sources: [item] } });
    expect(JSON.stringify(result)).toContain("apps/web");
    await expect(registerSourceBatch({
      projectRoot,
      namespace: "20261022",
      payload: { sources: [{ ...item, path: "apps/web" }] },
    })).rejects.toThrow("subpath");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
