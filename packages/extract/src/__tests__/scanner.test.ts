import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
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
});

describe("detectModules", () => {
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
      version: "0.0.0",
    });
    expect(boundaries).toContainEqual({
      name: "@fixture/pkg-b",
      path: "packages/pkg-b",
      manifest: "package.json",
      version: "0.0.0",
    });
    expect(boundaries.find((boundary) => boundary.path === ".")).toEqual({
      name: "repo-monorepo",
      path: ".",
      manifest: "package.json",
    });
  });
});
