import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseFile } from "../parser.js";

const fixturesDir = fileURLToPath(new URL("./fixtures/repo-ast/src", import.meta.url));

const loadFixture = (name: string) => readFile(join(fixturesDir, name), "utf-8");

describe("parseFile", () => {
  test("parses standard TypeScript source", async () => {
    const source = await loadFixture("sample.ts");
    const tree = await parseFile(source, false);
    expect(tree).not.toBeNull();
  });

  test("parses TSX source", async () => {
    const source = await loadFixture("component.tsx");
    const tree = await parseFile(source, true);
    expect(tree).not.toBeNull();
  });

  test("returns null on syntax error", async () => {
    const warnSpy = spyConsoleWarn();
    const tree = await parseFile("export const =", false);
    expect(tree).toBeNull();
    warnSpy.restore();
  });
});

const spyConsoleWarn = () => {
  const original = console.warn;
  console.warn = () => {};
  return { restore: () => (console.warn = original) };
};
