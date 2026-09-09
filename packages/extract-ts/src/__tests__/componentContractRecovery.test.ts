import { expect, test } from "bun:test";
import ts from "typescript";
import { EdgeType, SymbolKind, Visibility } from "@c4a/core";
import type { FileSystem, RelationInfo, SymbolInfo } from "@c4a/extract";
import { enrichPublicContracts } from "../publicContracts.js";

async function extract(files: Record<string, string>, names: Record<string, SymbolKind>) {
  const source = ts.createSourceFile("view.tsx", files["view.tsx"]!, ts.ScriptTarget.Latest, true);
  const symbols: SymbolInfo[] = Object.entries(names).map(([name, kind]) => {
    const declaration = source.statements.find(statement =>
      ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.some(item => item.name.getText(source) === name)
        : "name" in statement && (statement.name as ts.Node | undefined)?.getText(source) === name)!;
    return { name, kind, visibility: Visibility.Exported, file: "view.tsx",
      line: source.getLineAndCharacterOfPosition(declaration.getStart()).line + 1,
      endLine: source.getLineAndCharacterOfPosition(declaration.getEnd()).line + 1 };
  });
  const reads: string[] = [];
  const fs: FileSystem = {
    readFile: async path => { reads.push(path); if (!(path in files)) throw new Error(`Unauthorized read: ${path}`); return files[path]!; },
    readJson: async <T>() => ({} as T), readdir: async () => [], exists: async path => path in files,
  };
  const relations: RelationInfo[] = [];
  await enrichPublicContracts({ symbols, paths: Object.keys(files), fs, relations });
  expect(reads).toEqual(Object.keys(files));
  return { symbols, relations };
}

test("noLib preserves arrays within unions, nested objects and callbacks without claiming resolution", async () => {
  const { symbols } = await extract({ "view.tsx": `type Trigger = 'click' | 'hover';
export interface Props {
  triggerMode?: Trigger | Trigger[];
  config: { values: Trigger[] };
  onChange?: (values: Trigger[]) => Trigger | Trigger[];
  generic: Array<Trigger> | Trigger;
  empty: {};
}` }, { Props: SymbolKind.Interface });
  expect(symbols[0]?.members?.map(member => member.typeAnnotation)).toEqual([
    "Trigger | Trigger[]", "{ values: Trigger[] }", "(values: Trigger[]) => Trigger | Trigger[]",
    "Array<Trigger> | Trigger", "{}",
  ]);
  expect(symbols[0]?.members?.[0]?.optional).toBe(true);
  expect(symbols[0]?.contractResolution).toBe("declaration-only");
});

test("resolved generic substitutions and explicitly broad types remain complete", async () => {
  const { symbols } = await extract({ "view.tsx": `interface Box<T> { value: T; empty: {} }
export interface Props extends Box<string> { count: number; arbitrary: any; opaque: unknown }` }, { Props: SymbolKind.Interface });
  expect(symbols[0]?.members?.find(member => member.name === "value")?.typeAnnotation).toBe("string");
  expect(symbols[0]?.members?.find(member => member.name === "empty")?.typeAnnotation).toBe("{}");
  expect(symbols[0]?.members?.find(member => member.name === "arbitrary")?.typeAnnotation).toBe("any");
  expect(symbols[0]?.members?.find(member => member.name === "opaque")?.typeAnnotation).toBe("unknown");
  expect(symbols[0]?.contractResolution).toBe("resolved");
});

test("available array declarations preserve resolved generic contracts", async () => {
  const { symbols } = await extract({
    "array.d.ts": "interface Array<T> { length: number; [index: number]: T }",
    "view.tsx": `type Trigger = 'click' | 'hover';
export interface Props { triggerMode?: Trigger | Trigger[] }`,
  }, { Props: SymbolKind.Interface });
  expect(symbols[0]?.members?.[0]?.typeAnnotation).toBe("Trigger | Trigger[]");
  expect(symbols[0]?.contractResolution).toBe("resolved");
});

test("React additive wrappers retain local Props and per-component defaults without inventing children", async () => {
  const { symbols, relations } = await extract({ "view.tsx": `import type { FC, PropsWithChildren } from 'react';
export interface Props { label: string; testId?: string }
export const First: FC<PropsWithChildren<Props>> = ({ testId = 'first' }) => null;
export const Second: FC<PropsWithChildren<Props>> = ({ testId = 'second' }) => null;`,
  }, { First: SymbolKind.Component, Second: SymbolKind.Component, Props: SymbolKind.Interface });
  for (const symbol of symbols.slice(0, 2)) {
    expect(symbol.propsType).toBe("PropsWithChildren<Props>");
    expect(symbol.contractResolution).toBe("declaration-only");
    expect(symbol.members?.map(member => member.name)).toEqual(["label", "testId"]);
  }
  expect(symbols[0]?.members?.[1]?.defaultValue).toBe("'first'");
  expect(symbols[1]?.members?.[1]?.defaultValue).toBe("'second'");
  expect(symbols[2]?.members?.[1]?.defaultValue).toBeUndefined();
  expect(relations).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: EdgeType.OfType, from: "First", to: "Props", isExternal: false }),
    expect.objectContaining({ type: EdgeType.OfType, from: "Second", to: "Props", isExternal: false }),
  ]));
});

test.each([
  ["import type { FC, PropsWithChildren as WithChildren } from 'react';", "WithChildren<Props>"],
  ["import type React from 'react'; import type { FC } from 'react';", "React.PropsWithChildren<Props>"],
  ["import type * as R from 'react'; import type { FC } from 'react';", "R.PropsWithChildren<Props>"],
])("wrapper import identity survives alias and namespace syntax: %s", async (imports, annotation) => {
  const { symbols } = await extract({
    "view.tsx": `${imports}\nimport type { Props } from './props';\nexport const View: FC<${annotation}> = ({ testId = 'view' }) => null;`,
    "props.ts": "export interface Props { testId?: string }",
  }, { View: SymbolKind.Component });
  expect(symbols[0]?.members).toEqual([expect.objectContaining({ name: "testId", file: "props.ts", defaultValue: "'view'" })]);
  expect(symbols[0]?.contractResolution).toBe("declaration-only");
});

test("an unavailable inherited type does not hide explicit local Props inside a known wrapper", async () => {
  const { symbols } = await extract({ "view.tsx": `import type { FC, PropsWithChildren } from 'react';
import type { External } from 'outside';
type Props = { testId?: string } & External;
export const View: FC<PropsWithChildren<Props>> = ({ testId = 'view' }) => null;` }, { View: SymbolKind.Component });
  expect(symbols[0]?.members).toEqual([expect.objectContaining({ name: "testId", defaultValue: "'view'" })]);
  expect(symbols[0]?.contractResolution).toBe("declaration-only");
});

test.each([
  "import type { PropsWithChildren } from 'another-library';",
  "type PropsWithChildren<P> = UnknownTransform<P>;",
])("unknown wrappers cannot expose their generic argument as Props: %s", async wrapper => {
  const { symbols } = await extract({ "view.tsx": `import type { FC } from 'react';
${wrapper}
interface Props { invented: string }
export const View: FC<PropsWithChildren<Props>> = ({ invented = 'not-public' }) => null;` }, { View: SymbolKind.Component });
  expect(symbols[0]?.members).toBeUndefined();
  expect(symbols[0]?.contractResolution).toBe("declaration-only");
});

test("a branch-only Props field remains absent when a known wrapper contains an unresolved union", async () => {
  const { symbols } = await extract({ "view.tsx": `import type { FC, PropsWithChildren } from 'react';
import type { External } from 'outside';
type Props = { branchOnly: string } | External;
export const View: FC<PropsWithChildren<Props>> = () => null;` }, { View: SymbolKind.Component });
  expect(symbols[0]?.members).toBeUndefined();
});

test("available wrapper declarations retain their actual inherited fields", async () => {
  const { symbols } = await extract({
    "react.d.ts": "declare module 'react' { export type PropsWithChildren<P> = P & { children?: string }; export type FC<P> = (props: P) => null; }",
    "view.tsx": `import type { FC, PropsWithChildren } from 'react';
interface Props { testId?: string }
export const View: FC<PropsWithChildren<Props>> = ({ testId = 'view' }) => null;`,
  }, { View: SymbolKind.Component });
  expect(symbols[0]?.members?.map(member => member.name)).toEqual(["testId", "children"]);
  expect(symbols[0]?.members?.[0]?.defaultValue).toBe("'view'");
  expect(symbols[0]?.contractResolution).toBe("resolved");
});
