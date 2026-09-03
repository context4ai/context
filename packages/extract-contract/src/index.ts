export { parseContractSources } from "./contractParser.js";
export {
  contractSourcesToEvidenceAdapterMaterialization,
  contractSourcesToEvidenceAdapterResult,
} from "./evidenceAdapter.js";
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

export const CONTRACT_EVIDENCE_ADAPTER_EXPORT =
  "contractSourcesToEvidenceAdapterMaterialization";
