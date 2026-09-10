import { describe, expect, test } from "bun:test";
import { EdgeType } from "@c4a/core";
import type { FileSystem } from "@c4a/extract";
import { referencedTypeNames } from "../typeReferences.js";
import { analyzeFile } from "../symbolExtractorAnalyze.js";

describe("syntactic type references", () => {
  test("ignores comments, member names, literals and value queries", () => {
    expect(referencedTypeNames(`{
      /** The theme. Used by This module. */
      Theme: ActualConfig['theme'];
      label?: 'Compact' | 'Expanded';
      Template: \`Prefix\${otherConfig}\`;
      Values: typeof RuntimeValues;
      Alias: lowerCaseType;
      Nested: Promise<Namespace.Options>;
    }`)).toEqual(["ActualConfig", "otherConfig", "lowerCaseType", "Namespace.Options"]);
  });

  test("keeps constraints and referenced types but excludes locally bound type parameters", () => {
    expect(referencedTypeNames(`<T extends Base>(value: T, input: Input) => Result<T>`))
      .toEqual(["Base", "Input", "Result"]);
    expect(referencedTypeNames(`{ [Key in keyof Source as Alias<Key>]: Source[Key] }`))
      .toEqual(["Source", "Alias"]);
    expect(referencedTypeNames(`Source extends Container<infer Item> ? Result<Item> : Fallback`))
      .toEqual(["Source", "Container", "Result", "Fallback"]);
  });

  test("file extraction does not turn prose or enum values into confident AST edges", async () => {
    const source = `type ActualConfig = { theme: string };
      export type AppProps = {
        /** The theme. Used by This module. */
        theme: ActualConfig['theme'];
        label?: 'Compact' | 'Expanded';
      };
      export const Widget = factory.createWidget<AppProps>({});`;
    const fs: FileSystem = {
      readFile: async () => source, exists: async () => false, readdir: async () => [],
      readJson: async <T>() => ({} as T),
    };
    const result = await analyzeFile("src/index.ts", fs);
    const targets = [...new Set(result.relations.filter((edge) => edge.type === EdgeType.OfType)
      .map((edge) => edge.to))];
    expect(targets).toEqual(["ActualConfig", "AppProps"]);
    expect(result.relations.some((edge) => edge.type === EdgeType.OfType && edge.to.includes("createWidget"))).toBe(false);
  });
});
