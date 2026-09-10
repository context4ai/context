import { expect, test } from "bun:test";
import type { FileSystem, SymbolInfo } from "@c4a/extract";
import { SymbolKind, Visibility } from "@c4a/core";
import { enrichPublicContracts } from "../publicContracts.js";

test("public component contracts follow typed cross-file aliases and retain modifiers", async () => {
  const files: Record<string, string> = {
    "types.ts": 'export interface Shared { readonly label: string;\n/** @default 7 */\n count?: number }\nexport type Input = Shared & { mode: "a" | "b" };',
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
  expect(symbol.members?.find((member) => member.name === "count")?.defaultValue).toBe("7");
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

test("missing standard library does not erase explicit array types or change a genuine empty object", async () => {
  const source = 'export interface Props { items: Item[]; empty: {}; generic: Array<Item> }\nexport interface Item { key: string }';
  const fs: FileSystem = { readFile: async () => source, readJson: async <T>() => ({} as T), readdir: async () => [], exists: async () => true };
  const symbol: SymbolInfo = { name: "Props", kind: SymbolKind.Interface, visibility: Visibility.Exported, file: "props.ts", line: 1, endLine: 1 };
  await enrichPublicContracts({ symbols: [symbol], paths: ["props.ts"], fs });
  expect(symbol.members?.map(member => member.typeAnnotation)).toEqual(["Item[]", "{}", "Array<Item>"]);
});

test("unresolved intersection retains explicit exported fields without inventing inherited fields", async () => {
  const source = 'import type { External } from "outside";\nexport type Props = ({\n/** @default large */\nsizePreset?: "small" | "large"; value?: string;\n/** @internal */\nsecret?: string }) & External;';
  const fs: FileSystem = { readFile: async () => source, readJson: async <T>() => ({} as T), readdir: async () => [], exists: async () => false };
  const symbol: SymbolInfo = { name: "Props", kind: SymbolKind.Type, visibility: Visibility.Exported, file: "props.ts", line: 2, endLine: 8 };
  await enrichPublicContracts({ symbols: [symbol], paths: ["props.ts"], fs });
  expect(symbol.contractResolution).toBe("declaration-only");
  expect(symbol.members?.map(member => [member.name, member.visibility])).toEqual([
    ["sizePreset", Visibility.Exported], ["value", Visibility.Exported],
  ]);
  expect(symbol.members?.[0]?.typeAnnotation).toContain('"small"');
  expect(symbol.members?.[0]?.defaultValue).toBe("large");
  expect(symbol.members?.[1]?.defaultValue).toBeUndefined();
});

test("unresolved unions do not promote branch-only fields to common Props", async () => {
  const source = 'import type { External } from "outside";\nexport type Props = { branchOnly: string } | External;';
  const fs: FileSystem = { readFile: async () => source, readJson: async <T>() => ({} as T), readdir: async () => [], exists: async () => false };
  const symbol: SymbolInfo = { name: "Props", kind: SymbolKind.Type, visibility: Visibility.Exported, file: "props.ts", line: 2, endLine: 8 };
  await enrichPublicContracts({ symbols: [symbol], paths: ["props.ts"], fs });
  expect(symbol.members).toBeUndefined();
});

test("FC annotations link real Props and keep defaults scoped to each implementation", async () => {
  const source = `import type { FC } from 'react';
export interface Props {
/** @default false */
showToday?: boolean;
locale?: string;
activeDates?: string[];
}
export const First: FC<Props> = ({ showToday = true, locale = 'en-US', activeDates = [] }) => null;
export const Second: FC<Props> = ({ showToday = false }) => null;`;
  const fs: FileSystem = { readFile: async () => source, readJson: async <T>() => ({} as T), readdir: async () => [], exists: async () => false };
  const symbols: SymbolInfo[] = [
    { name: "First", kind: SymbolKind.Component, visibility: Visibility.Exported, file: "view.tsx", line: 8, endLine: 8 },
    { name: "Second", kind: SymbolKind.Component, visibility: Visibility.Exported, file: "view.tsx", line: 9, endLine: 9 },
    { name: "Props", kind: SymbolKind.Interface, visibility: Visibility.Exported, file: "view.tsx", line: 2, endLine: 7 },
  ];
  await enrichPublicContracts({ symbols, paths: ["view.tsx"], fs });
  expect(symbols[0]?.propsType).toBe("Props");
  expect(symbols[0]?.members?.map(m => m.defaultValue)).toEqual(["true", "'en-US'", "[]"]);
  expect(symbols[1]?.members?.[0]?.defaultValue).toBe("false");
  expect(symbols[2]?.members?.[0]?.defaultValue).toBe("false");
});

test("implementation defaults use static property keys, preserving expressions without evaluation", async () => {
  const source = `export interface Props {
/** @default false */
enabled?: boolean; label?: string; values?: string[]; nested?: { enabled?: boolean };
}
export const View = ({ 'enabled': local = true, label = getLabel(), values = [], nested: { enabled = false } }: Props) => null;`;
  const fs: FileSystem = { readFile: async () => source, readJson: async <T>() => ({} as T), readdir: async () => [], exists: async () => true };
  const symbol: SymbolInfo = { name: "View", kind: SymbolKind.Component, visibility: Visibility.Exported, file: "view.tsx", line: 5, endLine: 5 };
  await enrichPublicContracts({ symbols: [symbol], paths: ["view.tsx"], fs });
  expect(symbol.members?.map(member => [member.name, member.defaultValue])).toEqual([
    ["enabled", "true"], ["label", "getLabel()"], ["values", "[]"], ["nested", undefined],
  ]);
});
