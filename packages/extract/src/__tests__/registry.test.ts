import { PackageKind } from "@c4a/core";
import { describe, expect, test } from "bun:test";
import type { ExtractionPlugin, SourceInfo } from "../protocol.js";
import { ExtractionPluginRegistry } from "../registry.js";

const sourceInfo: SourceInfo = {
  path: "/repo",
  manifests: [
    {
      type: "package.json",
      path: "package.json",
      content: {
        name: "@fixture/demo",
      },
    },
  ],
  language: "typescript",
};

const createPlugin = (id: string, canHandle: boolean): ExtractionPlugin => ({
  id,
  languages: ["typescript", "tsx"],
  packageManagers: ["npm"],
  canHandle: () => canHandle,
  async detectEntries() {
    return {
      package: {
        name: "@fixture/demo",
        kind: PackageKind.Lib,
        language: "typescript",
      },
      entries: [],
    };
  },
  async extractSymbols() {
    throw new Error("not used in registry test");
  },
});

describe("ExtractionPluginRegistry", () => {
  test("resolve matches registered plugin by manifest and canHandle", () => {
    const registry = new ExtractionPluginRegistry();
    const rejectPlugin = createPlugin("reject", false);
    const tsPlugin = createPlugin("c4a-extract-ts", true);

    registry.register(rejectPlugin);
    registry.register(tsPlugin);

    expect(registry.resolve(sourceInfo)).toBe(tsPlugin);
  });

  test("resolve returns null when no plugin matches", () => {
    const registry = new ExtractionPluginRegistry();
    const rejectPlugin = createPlugin("reject", false);
    registry.register(rejectPlugin);

    expect(registry.resolve(sourceInfo)).toBeNull();
  });

  test("resolve returns null when registry is empty", () => {
    const registry = new ExtractionPluginRegistry();
    expect(registry.resolve(sourceInfo)).toBeNull();
  });

  test("resolve returns null for unknown manifest type", () => {
    const registry = new ExtractionPluginRegistry();
    const tsPlugin = createPlugin("c4a-extract-ts", true);
    registry.register(tsPlugin);

    const pythonSource: SourceInfo = {
      path: "/repo",
      manifests: [{ type: "pyproject.toml", path: "pyproject.toml", content: {} }],
      language: "python",
    };
    expect(registry.resolve(pythonSource)).toBeNull();
  });

  test("list returns a snapshot of registered plugins", () => {
    const registry = new ExtractionPluginRegistry();
    const tsPlugin = createPlugin("c4a-extract-ts", true);

    registry.register(tsPlugin);

    const listed = registry.list();
    listed.pop();

    expect(registry.list()).toHaveLength(1);
  });
});
