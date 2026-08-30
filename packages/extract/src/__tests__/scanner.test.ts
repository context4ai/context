import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { DEFAULT_PATH_FILTER } from "@c4a/core";
import { detectModuleBoundaries, detectModules, scanSourceFiles } from "../scanner.js";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));

const repoBasic = join(fixturesDir, "repo-basic");
const repoMonorepo = join(fixturesDir, "repo-monorepo");
const repoSingle = join(fixturesDir, "repo-single");
const repoNoRootManifest = join(fixturesDir, "repo-no-root-manifest");

describe("scanSourceFiles", () => {
  test("excludes default ignore paths and patterns", async () => {
    const files = await scanSourceFiles(repoBasic);
    expect(files).toEqual(["src/a.ts", "src/b.tsx"]);
  });

  test("excludes colocated TSX test and spec files from the default denominator", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-tsx-test-filter-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "component.tsx"), "export const Component = () => null;\n", "utf8");
      await writeFile(join(root, "src", "component.test.tsx"), "export const testOnly = true;\n", "utf8");
      await writeFile(join(root, "src", "component.spec.tsx"), "export const specOnly = true;\n", "utf8");
      expect(await scanSourceFiles(root)).toEqual(["src/component.tsx"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("includes JavaScript module extensions and excludes colocated JS tests", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-javascript-filter-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      for (const extension of ["js", "jsx", "mjs", "cjs", "mts", "cts"]) {
        await writeFile(join(root, "src", `entry.${extension}`), "export const value = true;\n", "utf8");
      }
      await writeFile(join(root, "src", "entry.test.js"), "export const testOnly = true;\n", "utf8");
      await writeFile(join(root, "src", "entry.spec.jsx"), "export const specOnly = true;\n", "utf8");

      expect(await scanSourceFiles(root)).toEqual([
        "src/entry.cjs",
        "src/entry.cts",
        "src/entry.js",
        "src/entry.jsx",
        "src/entry.mjs",
        "src/entry.mts",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("detectModules", () => {
  test("counts non-empty physical LOC for the quality inventory denominator", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-non-empty-loc-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "package.json"), '{"name":"non-empty-loc"}\n', "utf8");
      await writeFile(join(root, "src", "index.ts"), "export const first = 1;\n\n  \n// contract\n", "utf8");
      const modules = await detectModules(root);
      expect(modules[0]?.totalLines).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns complete identities for files removed by the configured code filter", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-code-filter-inventory-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "package.json"), '{"name":"filter-inventory"}\n', "utf8");
      await writeFile(join(root, "src", "index.ts"), "export const entry = true;\n", "utf8");
      await writeFile(join(root, "src", "entry.test.ts"), "export const testOnly = true;\n", "utf8");
      await writeFile(join(root, "src", "entry.spec.tsx"), "export const specOnly = true;\n", "utf8");
      await writeFile(join(root, "src", "types.d.ts"), "export interface GeneratedType {}\n", "utf8");

      const modules = await detectModules(root, undefined, DEFAULT_PATH_FILTER);
      expect(modules).toEqual([{
        name: "filter-inventory",
        path: ".",
        files: ["src/index.ts"],
        excludedFiles: ["src/entry.spec.tsx", "src/entry.test.ts", "src/types.d.ts"],
        fileCount: 1,
        totalLines: 1,
      }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("detects monorepo modules including root", async () => {
    const modules = await detectModules(repoMonorepo);

    // Root has package.json → included as a module even with child modules.
    // Root module captures files not belonging to any child (e.g. scripts/).
    // benchmark/ inside pkg-a is nested — findSubModuleDirs stops at pkg-a boundary.
    expect(modules.map((m) => m.name)).toEqual([
      "@fixture/pkg-a",
      "@fixture/pkg-b",
      "repo-monorepo",
    ]);

    const root = modules.find((m) => m.name === "repo-monorepo")!;
    expect(root.path).toBe(".");
    // Root module includes root-level files but excludes child module files
    expect(root.files).toEqual(["scripts/build.ts"]);
  });

  test("excludes nested sub-package files from parent module", async () => {
    const modules = await detectModules(repoMonorepo);
    const moduleA = modules.find((module) => module.name === "@fixture/pkg-a");
    // pkg-a/benchmark/ has its own package.json — its files must be excluded
    expect(moduleA!.files).toEqual(["packages/pkg-a/src/a.ts"]);
    expect(moduleA!.files.some((f) => f.includes("benchmark"))).toBe(false);
  });

  test("treats non-monorepo repo as single module", async () => {
    const modules = await detectModules(repoSingle);
    expect(modules).toEqual([
      {
        name: "repo-single",
        path: ".",
        files: ["src/index.ts"],
        fileCount: 1,
        totalLines: 1,
      },
    ]);
  });

  test("detects sub-directory modules when root has no manifest", async () => {
    const modules = await detectModules(repoNoRootManifest);
    expect(modules.map((m) => m.name)).toEqual(["my-app", "my-lib"]);
    expect(modules.map((m) => m.path)).toEqual(["app", "lib"]);

    const app = modules.find((m) => m.name === "my-app")!;
    expect(app.files).toEqual(["app/src/main.ts"]);

    const lib = modules.find((m) => m.name === "my-lib")!;
    expect(lib.files).toEqual(["lib/src/index.ts"]);
  });
});

describe("detectModuleBoundaries", () => {
  test("reports package versions for monorepo package boundaries", async () => {
    const boundaries = await detectModuleBoundaries(repoMonorepo);

    expect(boundaries).toContainEqual({
      name: "@fixture/pkg-a",
      path: "packages/pkg-a",
      manifest: "package.json",
      manifests: ["package.json"],
      version: "0.0.0",
    });
    expect(boundaries).toContainEqual({
      name: "@fixture/pkg-b",
      path: "packages/pkg-b",
      manifest: "package.json",
      manifests: ["package.json"],
      version: "0.0.0",
    });
    expect(boundaries.find((boundary) => boundary.path === ".")).toEqual({
      name: "repo-monorepo",
      path: ".",
      manifest: "package.json",
      manifests: ["package.json"],
    });
  });

  test("reports every manifest when one module contains multiple technology signals", async () => {
    const root = await mkdtemp(join(tmpdir(), "c4a-module-tech-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify({ name: "mixed-module" }));
      await writeFile(join(root, "go.mod"), "module example.test/mixed\n\ngo 1.23\n");

      expect(await detectModuleBoundaries(root)).toEqual([{
        name: "mixed-module",
        path: ".",
        manifest: "package.json",
        manifests: ["package.json", "go.mod"],
      }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
