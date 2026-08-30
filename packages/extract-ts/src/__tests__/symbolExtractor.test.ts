import { describe, expect, test } from "bun:test";
import { EdgeSource, EdgeType, Grounding, SymbolKind, Visibility } from "@c4a/core";
import type { ManifestInfo } from "@c4a/extract";
import { TypeScriptPlugin } from "../plugin.js";
import { countLines } from "../symbolExtractorAst.js";
import { getFixtureFs } from "./testUtils.js";

describe("TypeScriptPlugin", () => {
  test("reports non-empty physical LOC", () => {
    expect(countLines("export const first = 1;\n\n  \n// contract\n")).toBe(2);
  });

  test("extracts exported symbols through re-export chains and produces v2 relations", async () => {
    const fs = getFixtureFs("trace-project");
    const plugin = new TypeScriptPlugin();
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: await fs.readJson("package.json"),
    };

    const entryResult = await plugin.detectEntries(manifest, fs);
    const result = await plugin.extractSymbols(entryResult.entries, fs);

    expect(result.version).toBe("2");
    expect(result.package.name).toBe("@fixture/trace-project");
    expect(result.symbols.filter((item) => item.visibility === "exported").map((item) => item.name).sort()).toEqual([
      "ChatInput",
      "ChatInputProps",
      "ChatInputRef",
      "DEFAULT_WIDTH",
      "ImportedWidget",
      "PublicType",
      "Service",
      "TinyIcon",
      "WidgetMode",
      "WidgetRegistry",
      "createWidget",
      "formatWidget",
      "widgetClient",
    ]);
    const relationTypes = new Set(result.relations.map((item) => item.type));
    expect(relationTypes.has(EdgeType.Imports)).toBe(true);
    expect(relationTypes.has(EdgeType.ImportsType)).toBe(true);
    expect(relationTypes.has(EdgeType.Extends)).toBe(true);
    expect(relationTypes.has(EdgeType.Implements)).toBe(true);
    expect(relationTypes.has(EdgeType.ParamType)).toBe(true);
    expect(relationTypes.has(EdgeType.ReturnType)).toBe(true);
    expect(relationTypes.has(EdgeType.OfType)).toBe(true);
    expect(result.relations).toContainEqual(expect.objectContaining({
      type: EdgeType.Imports,
      from: "src/index.ts",
      to: "src/importedFacade.ts",
      isExternal: false,
    }));
  });

  test("marks exported and internal symbols with correct visibility", async () => {
    const fs = getFixtureFs("trace-project");
    const plugin = new TypeScriptPlugin();
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: await fs.readJson("package.json"),
    };

    const entryResult = await plugin.detectEntries(manifest, fs);
    const result = await plugin.extractSymbols(entryResult.entries, fs);

    const visibilityByName = new Map(result.symbols.map((item) => [item.name, item.visibility]));
    expect(visibilityByName.get("Service")).toBe(Visibility.Exported);
    expect(visibilityByName.get("TinyIcon")).toBe(Visibility.Exported);
    expect(visibilityByName.get("PublicType")).toBe(Visibility.Exported);
    expect(visibilityByName.get("createWidget")).toBe(Visibility.Exported);
    expect(visibilityByName.get("DEFAULT_WIDTH")).toBe(Visibility.Exported);
    expect(visibilityByName.get("formatWidget")).toBe(Visibility.Exported);
    expect(visibilityByName.get("WidgetMode")).toBe(Visibility.Exported);
    expect(visibilityByName.get("WidgetRegistry")).toBe(Visibility.Exported);
    expect(visibilityByName.get("widgetClient")).toBe(Visibility.Exported);
    expect(visibilityByName.get("ChatInput")).toBe(Visibility.Exported);
    expect(visibilityByName.get("ChatInputProps")).toBe(Visibility.Exported);
    expect(visibilityByName.get("ImportedWidget")).toBe(Visibility.Exported);
    expect(visibilityByName.get("BaseService")).toBe(Visibility.Internal);
    expect(visibilityByName.get("Runnable")).toBe(Visibility.Internal);
  });

  test("sets relation metadata to grounding=code source=ast confidence=1.0", async () => {
    const fs = getFixtureFs("trace-project");
    const plugin = new TypeScriptPlugin();
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: await fs.readJson("package.json"),
    };

    const entryResult = await plugin.detectEntries(manifest, fs);
    const result = await plugin.extractSymbols(entryResult.entries, fs);

    expect(result.relations.length).toBeGreaterThan(0);
    expect(
      result.relations.every(
        (relation) =>
          relation.grounding === Grounding.Code &&
          relation.source === EdgeSource.Ast &&
          relation.confidence === 1,
      ),
    ).toBe(true);
  });

  test("extracts enum values, arrow function signatures, and forwardRef props", async () => {
    const fs = getFixtureFs("trace-project");
    const plugin = new TypeScriptPlugin();
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: await fs.readJson("package.json"),
    };

    const entryResult = await plugin.detectEntries(manifest, fs);
    const result = await plugin.extractSymbols(entryResult.entries, fs);
    const byName = new Map(result.symbols.map((item) => [item.name, item]));

    expect(byName.get("WidgetMode")?.unionValues).toEqual(["Inline = inline", "Block = block"]);
    expect(byName.get("DEFAULT_WIDTH")?.initializer).toBe("420");
    expect(byName.get("widgetClient")?.initializer).toBe("new WidgetClient()");
    expect(byName.get("WidgetRegistry")?.members?.[0]).toMatchObject({
      name: "[name: string]",
      typeAnnotation: "PublicType",
    });
    expect(byName.get("formatWidget")?.params).toEqual([{ name: "input", type: "PublicType" }]);
    expect(byName.get("formatWidget")?.returnType).toBe("string");
    expect(byName.get("createWidget")?.signature).toBe("createWidget(input: PublicType)");
    expect(byName.get("ChatInput")?.propsType).toBe("ChatInputProps");
    expect(byName.get("ChatInput")?.typeAnnotation).toBe("forwardRef<ChatInputRef, ChatInputProps>");
    expect(byName.get("TinyIcon")?.returnType).toBe("JSX.Element");
    expect(byName.get("Service")?.members?.some((member) => member.name === "constructor")).toBe(true);
  });

  test("gives JS, JSX, MJS, and CJS the same AST catalog, export, and call capabilities", async () => {
    const fs = getFixtureFs("ecmascript-project");
    const plugin = new TypeScriptPlugin();
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: await fs.readJson("package.json"),
    };

    const entryResult = await plugin.detectEntries(manifest, fs);
    const result = await plugin.extractSymbols(entryResult.entries, fs);
    const exported = result.symbols
      .filter((item) => item.visibility === Visibility.Exported)
      .map((item) => item.name)
      .sort();

    expect(result.meta.language).toBe("javascript");
    expect(result.coverage?.tier).toBe("ast-catalog");
    expect(result.coverage?.capabilities).toEqual([
      "commonjs-module",
      "esm-module",
      "javascript-ast",
      "jsx-ast",
      "parser.javascript",
      "parser.typescript",
      "static-call-relations",
      "tsx-ast",
      "typescript-ast",
    ]);
    expect(result.files.map((file) => `${file.path}:${file.language}`).sort()).toEqual([
      "src/index.mjs:javascript",
      "src/legacy.cjs:javascript",
      "src/plain.js:javascript",
      "src/unsupported.cjs:javascript",
      "src/view.jsx:jsx",
    ]);
    expect(exported).toEqual(["Panel", "alias", "createTask", "legacyRun"]);
    expect(result.symbols.find((item) => item.name === "Panel")?.kind).toBe(SymbolKind.Component);
    expect(result.relations).toContainEqual(expect.objectContaining({
      type: EdgeType.Calls,
      from: "createTask",
      to: "helper",
      isExternal: false,
    }));
    expect(result.relations).toContainEqual(expect.objectContaining({
      type: EdgeType.Calls,
      from: "legacyRun",
      to: "formatValue",
      isExternal: false,
    }));
    expect(result.relations).toContainEqual(expect.objectContaining({
      type: EdgeType.Calls,
      from: "Panel",
      to: "formatLabel",
      isExternal: false,
    }));
  });

  test("marks unsupported dynamic CommonJS as a file-scoped diagnostic instead of silent success", async () => {
    const fs = getFixtureFs("ecmascript-project");
    const plugin = new TypeScriptPlugin();
    const manifest: ManifestInfo = {
      type: "package.json",
      path: "package.json",
      content: await fs.readJson("package.json"),
    };

    const entryResult = await plugin.detectEntries(manifest, fs);
    const result = await plugin.extractSymbols(entryResult.entries, fs);
    const file = result.coverage?.files.find((item) => item.path === "src/unsupported.cjs");

    expect(file).toEqual({
      path: "src/unsupported.cjs",
      disposition: "unsupported",
      diagnosticCodes: ["dynamic-commonjs-require"],
    });
    expect(result.coverage?.diagnostics).toContainEqual({
      code: "dynamic-commonjs-require",
      severity: "error",
      file: "src/unsupported.cjs",
      line: 2,
      column: 18,
    });
    expect(result.symbols.some((item) => item.file === "src/unsupported.cjs")).toBe(false);
  });
});
