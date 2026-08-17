import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { addRepoSource, ensureRepoSources } from "../project/repoSources.js";
import { initContextProject } from "../project/workspace.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("0.6.0 repo source portable local paths", () => {
  test("stores an absolute same-repository module as a relative root and keeps a movable relative symlink", async () => {
    const temp = await mkdtemp(join(tmpdir(), "context-repo-relative-"));
    const repository = join(temp, "product-monorepo");
    const packageRoot = join(repository, "workspaces", "catalog", "ui-kit");
    try {
      await mkdir(packageRoot, { recursive: true });
      git(repository, ["init", "-q"]);
      git(repository, ["config", "user.email", "test@example.com"]);
      git(repository, ["config", "user.name", "Test User"]);
      git(repository, ["remote", "add", "origin", "git@example.com:example/product-monorepo.git"]);
      await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
        name: "@example/ui-kit",
        version: "1.0.0",
        type: "module",
      }, null, 2)}\n`, "utf8");
      git(repository, ["add", "."]);
      git(repository, ["commit", "-qm", "add ui kit"]);
      const head = git(repository, ["rev-parse", "HEAD"]);

      const workspaceParent = join(repository, "workspaces", "catalog");
      const initialized = await initContextProject({ cwd: workspaceParent, projectDir: "context", dev: true });
      const result = await addRepoSource({
        projectRoot: initialized.projectRoot,
        namespace: "20260712",
        module: "ui-kit",
        local: packageRoot,
        remote: "git@example.com:example/product-monorepo.git",
        ref: head,
      });

      expect(result.source.local).toBe("../../..");
      expect(result.source.subpath).toBe("workspaces/catalog/ui-kit");
      const registry = YAML.parse(await readFile(join(initialized.projectRoot, "sources", "repo", "index.yaml"), "utf8")) as {
        sources: Array<{ modules: Array<{ local: string; subpath: string }> }>;
      };
      expect(registry.sources[0]?.modules[0]).toMatchObject({
        local: "../../..",
        subpath: "workspaces/catalog/ui-kit",
      });

      const link = join(initialized.projectRoot, "sources", "repo", "20260712", "ui-kit");
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      const linkTarget = await readlink(link);
      expect(isAbsolute(linkTarget)).toBe(false);
      expect(await realpath(link)).toBe(await realpath(packageRoot));

      const movedRepository = join(temp, "moved_monorepo");
      await rename(repository, movedRepository);
      const movedProject = join(movedRepository, "workspaces", "catalog", "context");
      const movedPackage = join(movedRepository, "workspaces", "catalog", "ui-kit");
      const movedLink = join(movedProject, "sources", "repo", "20260712", "ui-kit");
      expect(await realpath(movedLink)).toBe(await realpath(movedPackage));
      const status = (await ensureRepoSources({
        projectRoot: movedProject,
        name: "20260712/ui-kit",
      }))[0];
      expect(status?.ready).toBe(true);
      expect(status?.local).toBe("../../..");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
