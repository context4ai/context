import { loadSourcesRegistry } from "@c4a/context";
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { ContextError } from "../lib/errors.js";
import { addRepoSource, type AddRepoSourceInput } from "../project/repoSources.js";
import { initContextProject } from "../project/workspace.js";
import { invokeCliInDir } from "./documentSourcesV062Helpers.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function createMonorepo(root: string): Promise<{ root: string; head: string }> {
  const repository = join(root, "product-monorepo");
  for (const module of ["component-a", "component-b"]) {
    const moduleRoot = join(repository, "packages", module);
    await mkdir(moduleRoot, { recursive: true });
    await writeFile(join(moduleRoot, "package.json"), `${JSON.stringify({
      name: `@demo/${module}`,
      version: "1.0.0",
      type: "module",
    }, null, 2)}\n`, "utf8");
  }
  await mkdir(join(repository, "sample-web"), { recursive: true });
  await writeFile(join(repository, "sample-web", "package.json"), `${JSON.stringify({
    name: "@demo/sample-web",
    version: "1.0.0",
    type: "module",
  }, null, 2)}\n`, "utf8");
  git(repository, ["init", "-q"]);
  git(repository, ["config", "user.email", "test@example.com"]);
  git(repository, ["config", "user.name", "Test User"]);
  git(repository, ["remote", "add", "origin", "git@example.com:demo/product-monorepo.git"]);
  git(repository, ["add", "."]);
  git(repository, ["commit", "-qm", "add packages"]);
  return { root: repository, head: git(repository, ["rev-parse", "HEAD"]) };
}

describe("0.6.0 source registration concurrency and batch input", () => {
  test("registers repo and Lark modules from one mixed batch command", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-source-batch-"));
    try {
      const repository = await createMonorepo(root);
      const initialized = await initContextProject({ cwd: root, projectDir: "context", dev: true });
      const inputPath = join(initialized.projectRoot, "source-batch.yaml");
      await writeFile(inputPath, YAML.stringify({
        sources: [
          {
            type: "repo",
            module: "component-a",
            local: join(repository.root, "packages", "component-a"),
          },
          {
            type: "repo",
            module: "component-b",
            local: join(repository.root, "packages", "component-b"),
          },
          {
            type: "lark",
            wikiToken: "wiki-secret-token",
            title: "User Manual",
          },
        ],
      }), "utf8");

      const result = await invokeCliInDir(initialized.projectRoot, [
        "source", "add", "batch", "20260712",
        "--input", inputPath,
        "--format", "json",
      ]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout) as Record<string, unknown>).toMatchObject({
        kind: "source.registration.batch",
        namespace: "20260712",
        total: 3,
      });
      expect(result.stdout).not.toContain("wiki-secret-token");
      const registry = await loadSourcesRegistry({ rootDir: initialized.projectRoot });
      expect(registry.repos.map((source) => source.name)).toEqual([
        "20260712/component-a",
        "20260712/component-b",
      ]);
      expect(registry.repos.map((source) => source.remote)).toEqual([
        "git@example.com:demo/product-monorepo.git",
        "git@example.com:demo/product-monorepo.git",
      ]);
      expect(registry.repos.map((source) => source.ref)).toEqual([
        repository.head,
        repository.head,
      ]);
      expect(registry.larks.map((source) => source.name)).toEqual(["20260712/user-manual"]);
      expect(registry.larks[0]?.wikiToken).toBe("wiki-secret-token");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("infers a uniquely named sibling Git module when local is omitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-source-batch-inferred-local-"));
    try {
      const repository = await createMonorepo(root);
      const initialized = await initContextProject({ cwd: repository.root, projectDir: "context", dev: true });
      const inputPath = join(initialized.projectRoot, "source-batch.yaml");
      await writeFile(inputPath, YAML.stringify({
        sources: [{
          type: "repo",
          module: "sample-web",
        }],
      }), "utf8");

      const result = await invokeCliInDir(initialized.projectRoot, [
        "source", "add", "batch", "20260712", "--input", inputPath, "--format", "json",
      ]);

      expect(result.status).toBe(0);
      const registry = await loadSourcesRegistry({ rootDir: initialized.projectRoot });
      expect(registry.repos).toHaveLength(1);
      expect(registry.repos[0]).toMatchObject({
        name: "20260712/sample-web",
        local: "..",
        subpath: "sample-web",
        remote: "git@example.com:demo/product-monorepo.git",
        ref: repository.head,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("derives safe file and Lark modules when batch module is omitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-source-batch-derived-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "context", dev: true });
      await mkdir(join(root, "manual"), { recursive: true });
      const inputPath = join(initialized.projectRoot, "source-batch.yaml");
      await writeFile(inputPath, YAML.stringify({
        sources: [
          { type: "file", local: "../manual/Quick Start.MD" },
          { type: "lark", url: "https://example.larkoffice.com/wiki/Tf16wpeUYiNTDZkhGTRcB7tfnLg" },
        ],
      }), "utf8");

      const result = await invokeCliInDir(initialized.projectRoot, [
        "source", "add", "batch", "20260712", "--input", inputPath, "--format", "json",
      ]);

      expect(result.status).toBe(0);
      const registry = await loadSourcesRegistry({ rootDir: initialized.projectRoot });
      expect(registry.files.map((source) => source.name)).toEqual(["20260712/quick-start"]);
      expect(registry.larks).toHaveLength(1);
      expect(registry.larks[0]?.name).toMatch(/^20260712\/wiki-[a-f0-9]{12}$/u);
      expect(registry.larks[0]?.name).not.toContain("Tf16wpeUYiNTDZkhGTRcB7tfnLg");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects invalid explicit modules before earlier batch items are written", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-source-batch-invalid-module-"));
    try {
      const repository = await createMonorepo(root);
      const initialized = await initContextProject({ cwd: root, projectDir: "context", dev: true });
      const inputPath = join(initialized.projectRoot, "source-batch.yaml");
      await writeFile(inputPath, YAML.stringify({
        sources: [
          {
            type: "repo",
            module: "component-a",
            local: join(repository.root, "packages", "component-a"),
          },
          {
            type: "lark",
            module: "Tf16wpeUYiNTDZkhGTRcB7tfnLg",
            url: "https://example.larkoffice.com/wiki/Tf16wpeUYiNTDZkhGTRcB7tfnLg",
          },
        ],
      }), "utf8");

      const result = await invokeCliInDir(initialized.projectRoot, [
        "source", "add", "batch", "20260712", "--input", inputPath, "--format", "json",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must be a lowercase path-safe slug");
      const registry = await loadSourcesRegistry({ rootDir: initialized.projectRoot });
      expect(registry.repos).toEqual([]);
      expect(registry.larks).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("batch help documents the executable payload contract", async () => {
    const stdout = execFileSync(process.execPath, [
      join(import.meta.dir, "..", "cli.ts"),
      "source", "add", "batch", "--help",
    ], { encoding: "utf8" });
    expect(stdout).toContain("Payload example:");
    expect(stdout).toContain("repo.module is required");
    expect(stdout).toContain("file.module and lark.module are optional");
    expect(stdout).toContain("repo.local is resolved from the Context project root");
    expect(stdout).toContain("infer origin and the current commit");
    expect(stdout).toContain("one uniquely named Git directory");
  });

  test("reports an unresolved local repo path before asking for remote identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-source-batch-missing-local-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "context", dev: true });
      const inputPath = join(initialized.projectRoot, "source-batch.yaml");
      await writeFile(inputPath, YAML.stringify({
        sources: [{
          type: "repo",
          module: "component-a",
          local: "component-a",
        }],
      }), "utf8");

      const result = await invokeCliInDir(initialized.projectRoot, [
        "source", "add", "batch", "20260712", "--input", inputPath, "--format", "json",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("repo source local path does not exist: component-a");
      expect(result.stderr).not.toContain("repo source remote is required");
      const registry = await loadSourcesRegistry({ rootDir: initialized.projectRoot });
      expect(registry.repos).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports a non-Git local repo path before asking for remote identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-source-batch-non-git-local-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "context", dev: true });
      await mkdir(join(root, "component-a"), { recursive: true });
      const inputPath = join(initialized.projectRoot, "source-batch.yaml");
      await writeFile(inputPath, YAML.stringify({
        sources: [{
          type: "repo",
          module: "component-a",
          local: "../component-a",
        }],
      }), "utf8");

      const result = await invokeCliInDir(initialized.projectRoot, [
        "source", "add", "batch", "20260712", "--input", inputPath, "--format", "json",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("repo source local path is not inside a Git checkout: ../component-a");
      expect(result.stderr).not.toContain("repo source remote is required");
      const registry = await loadSourcesRegistry({ rootDir: initialized.projectRoot });
      expect(registry.repos).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects duplicate batch identities before writing any registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-source-batch-duplicate-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "context", dev: true });
      const inputPath = join(initialized.projectRoot, "source-batch.yaml");
      await writeFile(inputPath, YAML.stringify({
        sources: [
          { type: "file", module: "shared", local: "../docs" },
          { type: "lark", module: "shared", wikiToken: "wiki-token" },
        ],
      }), "utf8");

      const result = await invokeCliInDir(initialized.projectRoot, [
        "source", "add", "batch", "20260712", "--input", inputPath, "--format", "json",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("duplicates another source identity");
      const registry = await loadSourcesRegistry({ rootDir: initialized.projectRoot });
      expect(registry.files).toEqual([]);
      expect(registry.larks).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects colliding derived modules before writing any registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-source-batch-derived-duplicate-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "context", dev: true });
      const inputPath = join(initialized.projectRoot, "source-batch.yaml");
      await writeFile(inputPath, YAML.stringify({
        sources: [
          { type: "lark", title: "User Manual", wikiToken: "wiki-token-a" },
          { type: "lark", title: "User Manual", wikiToken: "wiki-token-b" },
        ],
      }), "utf8");

      const result = await invokeCliInDir(initialized.projectRoot, [
        "source", "add", "batch", "20260712", "--input", inputPath, "--format", "json",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("duplicates another source identity");
      const registry = await loadSourcesRegistry({ rootDir: initialized.projectRoot });
      expect(registry.larks).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("concurrent single-source writes fail cleanly and leave valid YAML", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-source-concurrency-"));
    try {
      const repository = await createMonorepo(root);
      const initialized = await initContextProject({ cwd: root, projectDir: "context", dev: true });
      const inputs: AddRepoSourceInput[] = ["component-a", "component-b"].map((module) => ({
        projectRoot: initialized.projectRoot,
        namespace: "20260712",
        module,
        local: join(repository.root, "packages", module),
        remote: "git@example.com:demo/product-monorepo.git",
        ref: repository.head,
      }));

      const results = await Promise.allSettled(inputs.map((input) => addRepoSource(input)));
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const rejection = rejected[0] as PromiseRejectedResult;
      expect(rejection.reason).toBeInstanceOf(ContextError);
      expect((rejection.reason as ContextError).message).toContain("context project write lock is already held");

      const registryPath = join(initialized.projectRoot, "sources", "repo", "index.yaml");
      const parsed = YAML.parse(await readFile(registryPath, "utf8")) as { sources: unknown[] };
      expect(parsed.sources).toHaveLength(1);
      const failedIndex = results.findIndex((result) => result.status === "rejected");
      const retry = inputs[failedIndex];
      expect(retry).toBeDefined();
      await addRepoSource(retry!);
      const registry = await loadSourcesRegistry({ rootDir: initialized.projectRoot });
      expect(registry.repos.map((source) => source.name).sort()).toEqual([
        "20260712/component-a",
        "20260712/component-b",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("batch registration refuses to write while another project mutation holds the lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-source-batch-lock-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "context", dev: true });
      const inputPath = join(initialized.projectRoot, "source-batch.yaml");
      await writeFile(inputPath, YAML.stringify({
        sources: [{ type: "lark", module: "user-manual", wikiToken: "wiki-token" }],
      }), "utf8");
      await mkdir(join(initialized.projectRoot, ".tmp", "context-runtime", "locks", "project-write.lock"), {
        recursive: true,
      });

      const result = await invokeCliInDir(initialized.projectRoot, [
        "source", "add", "batch", "20260712", "--input", inputPath, "--format", "json",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("context project write lock is already held");
      const registry = await loadSourcesRegistry({ rootDir: initialized.projectRoot });
      expect(registry.larks).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
