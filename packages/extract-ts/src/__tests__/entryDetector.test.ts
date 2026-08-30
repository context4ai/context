import { describe, expect, test } from "bun:test";
import { PackageKind } from "@c4a/core";
import type { ManifestInfo } from "@c4a/extract";
import { detectEntries } from "../entryDetector.js";
import { getFixtureFs } from "./testUtils.js";

describe("detectEntries", () => {
  test("parses exports/main/bin into package entries", async () => {
    const fs = getFixtureFs("entries-lib");
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: await fs.readJson("package.json"),
    };

    const result = await detectEntries(manifest, fs);

    expect(result.package.name).toBe("@fixture/entries-lib");
    expect(result.package.kind).toBe(PackageKind.Lib);
    const entryKeys = new Set(result.entries.map((entry) => `${entry.path}|${entry.subpath}|${entry.type}`));
    expect(entryKeys.has("src/index.ts|.|library")).toBe(true);
    expect(entryKeys.has("src/utils.ts|./utils|library")).toBe(true);
    expect(entryKeys.has("src/cli.ts|./bin/fixture-lib|cli")).toBe(true);
  });

  test("maps conditional dist exports back to src/index.ts", async () => {
    const fs = getFixtureFs("entries-lib");
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: {
        name: "@fixture/conditional-dist",
        version: "1.0.0",
        exports: {
          ".": {
            types: "./dist/cjs/index.d.ts",
            import: "./dist/esm/index.js",
            require: "./dist/cjs/index.js",
          },
        },
      },
    };

    const result = await detectEntries(manifest, fs);

    expect(result.entries).toEqual([
      { path: "src/index.ts", subpath: ".", type: "library" },
    ]);
  });

  test("does not map asset or missing subpath exports to the root entry", async () => {
    const fs = getFixtureFs("entries-lib");
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: {
        name: "@fixture/subpath-assets",
        version: "1.0.0",
        main: "./dist/index.js",
        exports: {
          ".": "./dist/index.js",
          "./styles.css": "./dist/esm/styles.css",
          "./missing-tool": "./dist/tools/missing-tool.js",
        },
      },
    };

    const result = await detectEntries(manifest, fs);

    expect(result.entries).toEqual([
      { path: "src/index.ts", subpath: ".", type: "library" },
    ]);
  });

  test("detects monorepo sub-packages from workspaces", async () => {
    const fs = getFixtureFs("entries-monorepo");
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: await fs.readJson("package.json"),
    };

    const result = await detectEntries(manifest, fs);

    expect(result.subPackages).toBeDefined();
    expect(result.subPackages).toHaveLength(2);
    expect(result.subPackages?.map((item) => item.package.name)).toEqual([
      "@fixture/pkg-a",
      "@fixture/pkg-b",
    ]);
    expect(result.subPackages?.every((item) => item.entries.length === 1)).toBe(true);
  });

  test("detects monorepo sub-packages from workspaces.packages", async () => {
    const fs = getFixtureFs("entries-monorepo");
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: {
        name: "@fixture/monorepo",
        private: true,
        workspaces: { packages: ["packages/*"] },
      },
    };

    const result = await detectEntries(manifest, fs);

    expect(result.subPackages?.map((item) => item.package.name)).toEqual([
      "@fixture/pkg-a",
      "@fixture/pkg-b",
    ]);
  });

  test("detects JavaScript, JSX, MJS, and CJS source entries without build-output remapping", async () => {
    const fs = getFixtureFs("ecmascript-project");
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: await fs.readJson("package.json"),
    };

    const result = await detectEntries(manifest, fs);

    expect(result.package.language).toBe("javascript");
    expect(result.entries.map((entry) => entry.path).sort()).toEqual([
      "src/index.mjs",
      "src/legacy.cjs",
      "src/plain.js",
      "src/unsupported.cjs",
      "src/view.jsx",
    ]);
  });
});
