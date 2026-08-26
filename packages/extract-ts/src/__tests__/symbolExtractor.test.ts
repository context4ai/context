import { describe, expect, test } from "bun:test";
import { EdgeSource, EdgeType, Grounding, Visibility } from "@c4a/core";
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
});
