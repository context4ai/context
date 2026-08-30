export { TypeScriptPlugin } from "./plugin.js";
export { extractReactRouterRoutes } from "./reactRouter.js";
export type { ReactRouterRoute, ReactRouterRouteKind, ReactRouterSourceLocation } from "./reactRouter.js";
export { extractEcmaScriptModuleExports, extractTypeScriptModuleExports } from "./moduleExports.js";
export type { EcmaScriptModuleExports, TypeScriptModuleExports } from "./moduleExports.js";
export {
  ecmaScriptLanguage,
  EXTRACT_TS_CAPABILITIES,
  EXTRACT_TS_COVERAGE_TIER,
} from "./ecmaScriptLanguage.js";
export type { EcmaScriptLanguage } from "./ecmaScriptLanguage.js";
export {
  typeScriptExtractionToEvidenceAdapterMaterialization,
  typeScriptExtractionToEvidenceAdapterResult,
} from "./evidenceAdapter.js";
