import { expect, test } from "bun:test";
import type { FileSystem, SymbolInfo } from "@c4a/extract";
import { SymbolKind, Visibility } from "@c4a/core";
import { enrichPublicContracts } from "../publicContracts.js";

test("public component contracts follow typed cross-file aliases and retain modifiers", async () => {
  const files: Record<string, string> = {
    "types.ts": 'export interface Shared { readonly label: string; count?: number }\nexport type Input = Shared & { mode: "a" | "b" };',
    "view.tsx": 'import { Input } from "./types";\nexport function View(props: Input) { return <div>{props.label}</div>; }\nexport interface ViewProps { incorrect: boolean }',
  };
  const fs: FileSystem = { readFile: async (path) => files[path]!,
    readJson: async <T>() => ({} as T), readdir: async () => [], exists: async (path) => path in files };
  const symbol: SymbolInfo = { name: "View", kind: SymbolKind.Component, visibility: Visibility.Exported,
    file: "view.tsx", line: 2, endLine: 2 };
  await enrichPublicContracts({ symbols: [symbol], paths: Object.keys(files), fs });
  expect(symbol.propsType).toBe("Input");
  expect(symbol.members?.map((member) => member.name)).toEqual(["label", "count", "mode"]);
  expect(symbol.members?.find((member) => member.name === "label")?.readonly).toBe(true);
  expect(symbol.members?.find((member) => member.name === "count")?.optional).toBe(true);
  expect(symbol.members?.some((member) => member.name === "incorrect")).toBe(false);
  expect(symbol.overloads).toBeUndefined();
});

test("missing imported types remain declaration-only without guessing named Props", async () => {
  const source = 'import { Missing } from "outside";\nexport function View(props: Missing) { return null; }\nexport interface ViewProps { invented: string }';
  const fs: FileSystem = { readFile: async () => source, readJson: async <T>() => ({} as T),
    readdir: async () => [], exists: async () => false };
  const symbol: SymbolInfo = { name: "View", kind: SymbolKind.Component, visibility: Visibility.Exported,
    file: "view.tsx", line: 2, endLine: 2 };
  await enrichPublicContracts({ symbols: [symbol], paths: ["view.tsx"], fs });
  expect(symbol.propsType).toBe("Missing");
  expect(symbol.contractResolution).toBe("declaration-only");
  expect(symbol.members).toBeUndefined();
});

test("retains written generic overloads without adding an inferred implementation signature", async () => {
  const source = `export function choose<T>(value: T): T;
export function choose<T>(value: T, fallback: T): T;
export function choose<T>(value: T, fallback?: T) { return value ?? fallback; }`;
  const fs: FileSystem = { readFile: async () => source, readJson: async <T>() => ({} as T),
    readdir: async () => [], exists: async () => true };
  const symbol: SymbolInfo = { name: "choose", kind: SymbolKind.Function, visibility: Visibility.Exported,
    file: "choose.ts", line: 3, endLine: 3 };
  await enrichPublicContracts({ symbols: [symbol], paths: ["choose.ts"], fs });
  expect(symbol.overloads).toEqual([
    "export function choose<T>(value: T): T",
    "export function choose<T>(value: T, fallback: T): T",
  ]);
});
