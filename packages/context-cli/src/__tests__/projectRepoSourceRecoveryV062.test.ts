import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readlink, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  repositoryRecoveryPlan,
  restoreRepositorySources,
} from "../project/repoSourceRecovery.js";
import { writeRepoRegistry } from "../project/repoSourceRegistry.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

async function fixture(): Promise<{
  root: string;
  project: string;
  checkout: string;
  commit: string;
  remote: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "context-repo-recovery-"));
  roots.push(root);
  const project = join(root, "context");
  const checkout = join(root, "source");
  await mkdir(join(project, "sources", "repo"), { recursive: true });
  await mkdir(join(checkout, "packages", "alpha"), { recursive: true });
  await mkdir(join(checkout, "packages", "beta"), { recursive: true });
  git(checkout, ["init"]);
  git(checkout, ["config", "user.name", "Context Test"]);
  git(checkout, ["config", "user.email", "context@example.com"]);
  await writeFile(join(checkout, "packages", "alpha", "index.ts"), "export const alpha = true;\n");
  await writeFile(join(checkout, "packages", "beta", "index.ts"), "export const beta = true;\n");
  git(checkout, ["add", "."]);
  git(checkout, ["commit", "-m", "fixture"]);
  const commit = git(checkout, ["rev-parse", "HEAD"]);
  const remote = "git@example.com:example/product-monorepo.git";
  git(checkout, ["remote", "add", "origin", remote]);
  await writeRepoRegistry(project, {
    repos: [
      {
        name: "20260813/alpha",
        namespace: "20260813",
        module: "alpha",
        local: "resources/product-monorepo",
        subpath: "packages/alpha",
        git: { remote, ref: commit },
      },
      {
        name: "20260813/beta",
        namespace: "20260813",
        module: "beta",
        local: "resources/product-monorepo",
        subpath: "packages/beta",
        git: { remote, ref: commit },
      },
    ],
  });
  return { root, project, checkout, commit, remote };
}

describe("repository source recovery", () => {
  test("groups logical modules and restores them from one explicit local checkout", async () => {
    const input = await fixture();
    const plan = await repositoryRecoveryPlan({ projectRoot: input.project });
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]?.sources).toEqual(["20260813/alpha", "20260813/beta"]);
    expect(plan.groups[0]?.ready).toBe(false);
    expect(plan.pending_groups).toBe(1);
    expect(plan.next_action?.command).toContain("context source restore");

    const result = await restoreRepositorySources({
      projectRoot: input.project,
      payload: {
        schema: "context.repository-source-recovery.v1",
        repositories: [{ source: plan.groups[0]!.id, mode: "local", path: input.checkout }],
      },
    });

    expect(result.restored).toEqual([expect.objectContaining({
      mode: "local",
      ready: true,
      sources: ["20260813/alpha", "20260813/beta"],
    })]);
    expect(await readlink(join(input.project, "resources", "product-monorepo"))).toBe(
      relative(join(input.project, "resources"), input.checkout),
    );
    expect(await readlink(join(input.project, "sources", "repo", "20260813", "alpha"))).toContain(
      "resources/product-monorepo/packages/alpha",
    );
    const readyPlan = await repositoryRecoveryPlan({ projectRoot: input.project });
    expect(readyPlan.pending_groups).toBe(0);
    expect(readyPlan.next_action).toBeNull();
  });

  test("clones the pinned commit into the disposable repository cache", async () => {
    const input = await fixture();
    const bare = join(input.root, "origin.git");
    execFileSync("git", ["clone", "--bare", input.checkout, bare], { encoding: "utf8" });
    git(input.checkout, ["remote", "set-url", "origin", bare]);
    await writeRepoRegistry(input.project, {
      repos: [{
        name: "20260813/alpha",
        namespace: "20260813",
        module: "alpha",
        subpath: "packages/alpha",
        git: { remote: bare, ref: input.commit },
      }],
    });

    const result = await restoreRepositorySources({
      projectRoot: input.project,
      payload: {
        schema: "context.repository-source-recovery.v1",
        repositories: [{ source: "20260813/alpha", mode: "clone" }],
      },
    });

    expect(result.restored[0]).toEqual(expect.objectContaining({ mode: "clone", ready: true }));
    expect(result.restored[0]?.checkout).toContain(join(input.project, ".tmp", "repo"));
  });
});
