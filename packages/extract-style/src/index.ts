export { parseStyleSources } from "./styleParser.js";
export { styleSourcesToEvidenceAdapterResult } from "./evidenceAdapter.js";
export type { StyleEvidenceAdapterInvocation } from "./evidenceAdapter.js";
export type {
  StyleComponentCandidate,
  StyleDiagnostic,
  StyleDocumentCatalog,
  StyleImport,
  StyleLocator,
  StyleSelector,
  StyleToken,
  StyleTokenReference,
  StyleVariantState,
} from "./styleTypes.js";

export const STYLE_EVIDENCE_ADAPTER_EXPORT = "styleSourcesToEvidenceAdapterResult";
