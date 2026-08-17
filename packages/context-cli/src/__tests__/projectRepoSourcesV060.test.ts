import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { addRepoSource, ensureRepoSources } from "../project/repoSources.js";
import {
  REPO_NAMESPACE,
  commitAll,
  initGitRepo,
  initTsMonorepoFixture,
  makeTmp,
  runCliInDir,
  writeSampleLibProjectEntry,
} from "./projectV060Helpers.js";

describe("0.6.0 repository source behavior", () => {
  test("source add repo accepts a monorepo subdirectory and scopes extraction to it", async () => {
    const root = makeTmp();
    const monorepo = join(root, "product_monorepo");
    const packageDir = join(monorepo, "packages", "component-lib");
    const project = join(root, "kb");
    try {
      await mkdir(join(packageDir, "src"), { recursive: true });
      execFileSync("git", ["init", "-q"], { cwd: monorepo });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: monorepo });
      execFileSync("git", ["config", "user.name", "Test User"], { cwd: monorepo });
      execFileSync("git", ["remote", "add", "origin", "git@example.com:example/product_monorepo.git"], { cwd: monorepo });
      writeFileSync(join(packageDir, "package.json"), `${JSON.stringify({
        name: "@demo/component-lib",
        version: "1.0.0",
        type: "module",
        exports: "./src/index.ts",
      }, null, 2)}\n`, "utf8");
      writeFileSync(join(packageDir, "src", "index.ts"), [
        "export function ComponentButton() {",
        '  return "button";',
        "}",
        "",
      ].join("\n"), "utf8");
      const head = commitAll(monorepo, "add component package");

      await runCliInDir(root, ["init", "kb"]);
      await writeFile(join(project, "src", "index.ts"), [
        'import { defineProject, extractTs, reviewValidity, source } from "@c4a/context";',
        "",
        'const componentLib = source("20260712", "component-lib");',
        "",
        "export default defineProject({",
        "  sources: [componentLib],",
        "  phases: [",
        '    extractTs({ source: componentLib, collection: "codegraph" }),',
        '    reviewValidity({ collection: "codegraph" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      await runCliInDir(project, ["source", "add", "repo", REPO_NAMESPACE, "--module", "component-lib", "--local", packageDir]);

      const registry = YAML.parse(await readFile(join(project, "sources", "repo", "index.yaml"), "utf8")) as {
        sources: Array<{ name: string; modules: Array<{ name: string; local: string; subpath?: string; git: { remote: string; ref: string } }> }>;
      };
      expect(registry.sources[0]).toMatchObject({
        name: REPO_NAMESPACE,
        modules: [{
          name: "component-lib",
          local: monorepo,
          subpath: "packages/component-lib",
          git: {
            remote: "git@example.com:example/product_monorepo.git",
            ref: head,
          },
        }],
      });

      const link = join(project, "sources", "repo", REPO_NAMESPACE, "component-lib");
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(realpathSync(link)).toBe(realpathSync(packageDir));

      const sourceGet = JSON.parse(await runCliInDir(project, ["source", "get", "20260712/component-lib", "--format", "json"])) as {
        local: string;
        subpath: string;
      };
      expect(sourceGet.local).toBe(monorepo);
      expect(sourceGet.subpath).toBe("packages/component-lib");

      writeFileSync(join(monorepo, "CONTEXT_NOTES.md"), "# Knowledge workspace notes\n", "utf8");
      const unrelatedHead = commitAll(monorepo, "update context notes outside source boundary");
      const unchangedBoundaryStatus = (await ensureRepoSources({
        projectRoot: project,
        name: "20260712/component-lib",
      }))[0];
      expect(unchangedBoundaryStatus?.head).toBe(unrelatedHead);
      expect(unchangedBoundaryStatus?.ref).toBe(head);
      expect(unchangedBoundaryStatus?.scopeMatches).toBe(true);
      expect(unchangedBoundaryStatus?.scopeHash).toBe(unchangedBoundaryStatus?.pinnedScopeHash);
      expect(unchangedBoundaryStatus?.ready).toBe(true);

      writeFileSync(join(packageDir, "src", "input.ts"), [
        "export function ComponentInput() {",
        '  return "input";',
        "}",
        "",
      ].join("\n"), "utf8");
      const nextHead = commitAll(monorepo, "update component package");
      const changedBoundaryStatus = (await ensureRepoSources({
        projectRoot: project,
        name: "20260712/component-lib",
      }))[0];
      expect(changedBoundaryStatus?.scopeMatches).toBe(false);
      expect(changedBoundaryStatus?.ready).toBe(false);
      expect(changedBoundaryStatus?.diagnostics.join("\n")).toContain(
        "source boundary packages/component-lib hash",
      );
      await runCliInDir(project, ["source", "add", "repo", REPO_NAMESPACE, "--module", "component-lib", "--ref", nextHead]);
      const updatedRegistry = YAML.parse(await readFile(join(project, "sources", "repo", "index.yaml"), "utf8")) as {
        sources: Array<{ name: string; modules: Array<{ name: string; local: string; subpath?: string; git: { remote: string; ref: string } }> }>;
      };
      expect(updatedRegistry.sources[0]).toMatchObject({
        name: REPO_NAMESPACE,
        modules: [{
          name: "component-lib",
          local: monorepo,
          subpath: "packages/component-lib",
          git: { ref: nextHead },
        }],
      });

      await runCliInDir(project, ["run", "extract:20260712/component-lib:codegraph"]);
      const ledger = readFileSync(join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), "utf8");
      expect(ledger).toContain("ComponentButton");
      expect(ledger).toContain('"candidate_id":"codegraph/component-lib/symbol/componentbutton"');
      expect(ledger).not.toContain("component-lib/demo-component-lib");
      expect(ledger).toContain("repo:20260712/component-lib#symbol:src/index.ts:ComponentButton:function@");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("source inspect reports monorepo module boundaries and source suggestions", async () => {
    const root = makeTmp();
    const monorepo = join(root, "product_monorepo");
    const project = join(root, "kb");
    try {
      await mkdir(monorepo, { recursive: true });
      const head = initTsMonorepoFixture(monorepo);
      await runCliInDir(root, ["init", "kb"]);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        REPO_NAMESPACE,
        "--module",
        "product",
        "--local",
        "../product_monorepo",
        "--remote",
        "https://git.example.com/product.git",
        "--ref",
        head,
      ]);

      const inspect = JSON.parse(await runCliInDir(project, [
        "source",
        "inspect",
        "20260712/product",
        "--format",
        "json",
      ])) as Array<{
        source: { name: string };
        moduleCount: number;
        modules: Array<{ name: string; path: string; version?: string }>;
        recommended_sources: Array<{ module: string; local: string; command: string }>;
        agent_hints: string[];
      }>;

      expect(inspect[0]?.source.name).toBe("20260712/product");
      expect(inspect[0]?.moduleCount).toBe(2);
      expect(inspect[0]?.modules).toEqual([
        expect.objectContaining({ name: "@demo/button", path: "packages/button", version: "1.0.0" }),
        expect.objectContaining({ name: "@demo/link", path: "packages/link", version: "1.0.0" }),
      ]);
      expect(inspect[0]?.recommended_sources).toContainEqual(expect.objectContaining({
        module: "@demo/button",
        local: "../product_monorepo/packages/button",
        command: "context source add repo 20260712 --module button --local ../product_monorepo/packages/button",
      }));
      expect(inspect[0]?.agent_hints).toEqual(["source-boundary-confirmation-required"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("source add keeps registry entries in minimal committed shape", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initGitRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeSampleLibProjectEntry(project);
      await writeFile(join(project, "sources", "repo", "index.yaml"), YAML.stringify({
        sources: [{
          name: REPO_NAMESPACE,
          modules: [{
            name: "sample-lib",
            local: "../sample-lib",
            git: {
              remote: "https://git.example.com/sample-lib.git",
              ref: head,
            },
          }],
        }],
      }), "utf8");

      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "other-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/other-lib.git",
        ref: head,
      });

      const registry = YAML.parse(await readFile(join(project, "sources", "repo", "index.yaml"), "utf8")) as {
        sources: Array<{
          name: string;
          modules: Array<{
            name: string;
            id?: string;
            local?: string;
            materializedAt?: string;
            git: { remote: string; ref: string };
          }>;
        }>;
      };
      expect(registry.sources).toHaveLength(1);
      expect(registry.sources[0]?.name).toBe(REPO_NAMESPACE);
      const sample = registry.sources[0]?.modules.find((module) => module.name === "sample-lib");
      expect(sample).toEqual({
        name: "sample-lib",
        local: "../sample-lib",
        git: {
          remote: "https://git.example.com/sample-lib.git",
          ref: head,
        },
      });
      const other = registry.sources[0]?.modules.find((module) => module.name === "other-lib");
      expect(other).toEqual({
        name: "other-lib",
        local: "../sample-lib",
        git: {
          remote: "https://git.example.com/other-lib.git",
          ref: head,
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("project status diagnoses repo sources without materializing symlinks", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initGitRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeFile(join(project, "sources", "repo", "index.yaml"), YAML.stringify({
        sources: [{
          name: REPO_NAMESPACE,
          modules: [{
            name: "sample-lib",
            local: "../sample-lib",
            git: {
              remote: "https://git.example.com/sample-lib.git",
              ref: head,
            },
          }],
        }],
      }), "utf8");

      const link = join(project, "sources", "repo", REPO_NAMESPACE, "sample-lib");
      expect(existsSync(link)).toBe(false);

      const status = await runCliInDir(project, ["status"]);
      expect(status).toContain("state: route.source.repository-not-ready");
      expect(status).toContain("diagnostic 20260712/sample-lib: materialized path is missing: sources/repo/20260712/sample-lib");
      expect(status).toContain("agent hint 20260712/sample-lib: Run context source ensure 20260712/sample-lib to materialize the local source link.");
      expect(existsSync(link)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});
