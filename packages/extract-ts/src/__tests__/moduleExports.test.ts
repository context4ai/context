import { describe, expect, test } from "bun:test";
import { extractTypeScriptModuleExports } from "../moduleExports.js";

describe("extractTypeScriptModuleExports", () => {
  test("collects declaration, named, wildcard, and target exports deterministically", () => {
    const result = extractTypeScriptModuleExports(`
      export const beta = 2, alpha = 1;
      export function run() {}
      export interface Options {}
      export { local as publicName } from "./named";
      export * from "./wildcard";
      export * as tools from "./tools";
      const hidden = true;
    `);

    expect(result).toEqual({
      named: ["Options", "alpha", "beta", "publicName", "run", "tools"],
      wildcard: ["./wildcard"],
      targets: ["./named", "./tools", "./wildcard"],
    });
  });

  test("does not expose local declarations without an export modifier", () => {
    expect(extractTypeScriptModuleExports("const local = 1; class Internal {};")).toEqual({
      named: [],
      wildcard: [],
      targets: [],
    });
  });
});
