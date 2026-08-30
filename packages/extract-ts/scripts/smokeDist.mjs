import {
  EXTRACT_TS_COVERAGE_TIER,
  TypeScriptPlugin,
  extractEcmaScriptModuleExports,
} from "../dist/index.js";

const plugin = new TypeScriptPlugin();
const commonJs = extractEcmaScriptModuleExports(
  "function run() {} exports.run = run;",
  "src/index.cjs",
);
const jsx = extractEcmaScriptModuleExports(
  "export const View = () => <main />;",
  "src/view.jsx",
);
const degraded = extractEcmaScriptModuleExports(
  "const target = './runtime.cjs'; module.exports = require(target);",
  "src/dynamic.cjs",
);

if (
  EXTRACT_TS_COVERAGE_TIER !== "ast-catalog" ||
  !plugin.languages.includes("javascript") ||
  !plugin.languages.includes("jsx") ||
  !plugin.capabilities.includes("commonjs-module") ||
  commonJs.named[0] !== "run" ||
  jsx.named[0] !== "View" ||
  degraded.disposition !== "unsupported" ||
  degraded.diagnostics[0]?.code !== "dynamic-commonjs-require"
) {
  throw new Error("Unexpected published ECMAScript extraction contract");
}

console.log(JSON.stringify({
  state: "extract-ts-dist-ready",
  node: process.version,
  coverageTier: plugin.coverageTier,
  commonJsExport: commonJs.named[0],
  jsxExport: jsx.named[0],
  degraded: degraded.diagnostics[0]?.code,
}));
