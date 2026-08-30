export { parseContractSources } from "./contractParser.js";
export { contractSourcesToEvidenceAdapterResult } from "./evidenceAdapter.js";
export type { ContractEvidenceAdapterInvocation } from "./evidenceAdapter.js";
export type {
  ContractDiagnostic,
  ContractDocumentCatalog,
  ContractEndpoint,
  ContractLocator,
  ContractOperation,
  ContractReference,
  ContractType,
} from "./contractTypes.js";

export const CONTRACT_EVIDENCE_ADAPTER_EXPORT = "contractSourcesToEvidenceAdapterResult";
