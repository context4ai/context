import { describe, expect, test } from "bun:test";
import { extractEcmaScriptModuleExports, extractTypeScriptModuleExports } from "../moduleExports.js";

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

describe("extractEcmaScriptModuleExports", () => {
  test("reports deterministic CommonJS exports and AST catalog capability", () => {
    const result = extractEcmaScriptModuleExports(`
      const { run } = require("./runtime.cjs");
      function local(value) { return run(value); }
      exports.execute = local;
      module.exports.alias = local;
    `, "src/index.cjs");

    expect(result).toMatchObject({
      named: ["alias", "execute"],
      wildcard: [],
      targets: ["./runtime.cjs"],
      coverageTier: "ast-catalog",
      disposition: "analyzed",
      diagnostics: [],
    });
    expect(result.capabilities).toContain("commonjs-module");
    expect(result.capabilities).toContain("parser.javascript");
    expect(result.capabilities).toContain("parser.typescript");
    expect(result.capabilities).toContain("static-call-relations");
  });

  test("supports static CommonJS bracket notation without treating it as dynamic", () => {
    const result = extractEcmaScriptModuleExports(`
      function run() {}
      exports["run"] = run;
      module["exports"]["alias"] = run;
    `, "src/index.cjs");

    expect(result.named).toEqual(["alias", "run"]);
    expect(result.disposition).toBe("analyzed");
    expect(result.diagnostics).toEqual([]);
  });

  test("does not claim analyzed coverage for a dynamic require", () => {
    const result = extractEcmaScriptModuleExports(
      "const target = './runtime.cjs'; module.exports = require(target);",
      "src/index.cjs",
    );

    expect(result.disposition).toBe("unsupported");
    expect(result.named).toEqual([]);
    expect(result.targets).toEqual([]);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: "dynamic-commonjs-require",
      line: 1,
    })]);
  });

  test("returns a stable locator for JavaScript syntax errors", () => {
    const result = extractEcmaScriptModuleExports("export const broken = ;", "src/broken.js");

    expect(result.disposition).toBe("unsupported");
    expect(result.named).toEqual([]);
    expect(result.targets).toEqual([]);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: "ecmascript-syntax-error",
      line: 1,
      column: 23,
    })]);
  });

  test("degrades dynamic CommonJS export keys and unsupported export expressions", () => {
    const dynamic = extractEcmaScriptModuleExports(
      "const key = 'run'; exports[key] = () => true;",
      "src/dynamic.cjs",
    );
    const unsupported = extractEcmaScriptModuleExports(
      "module.exports = factory();",
      "src/factory.cjs",
    );

    expect(dynamic.diagnostics).toEqual([expect.objectContaining({
      code: "dynamic-commonjs-export",
    })]);
    expect(dynamic.named).toEqual([]);
    expect(unsupported.diagnostics).toEqual([expect.objectContaining({
      code: "unsupported-commonjs-export-expression",
    })]);
    expect(unsupported.named).toEqual([]);
  });

  test("does not silently accept unsupported CommonJS export helper forms", () => {
    const defineProperty = extractEcmaScriptModuleExports(
      "Object.defineProperty(exports, 'run', { get: () => run });",
      "src/define-property.cjs",
    );
    const exportStar = extractEcmaScriptModuleExports(
      "__exportStar(require('./runtime.cjs'), exports);",
      "src/export-star.cjs",
    );
    const markerOnly = extractEcmaScriptModuleExports(
      "Object.defineProperty(exports, '__esModule', { value: true }); exports.run = () => true;",
      "src/marker.cjs",
    );

    expect(defineProperty.diagnostics).toEqual([expect.objectContaining({
      code: "unsupported-commonjs-export-form",
    })]);
    expect(defineProperty.named).toEqual([]);
    expect(exportStar.diagnostics).toEqual([expect.objectContaining({
      code: "unsupported-commonjs-export-form",
    })]);
    expect(exportStar.named).toEqual([]);
    expect(markerOnly.disposition).toBe("analyzed");
    expect(markerOnly.named).toEqual(["run"]);
  });
});
