export { parseSqlSources } from "./sqlParser.js";
export { splitSqlStatements } from "./sqlStatements.js";
export {
  sqlSourcesToEvidenceAdapterMaterialization,
  sqlSourcesToEvidenceAdapterResult,
} from "./evidenceAdapter.js";
export type { SqlEvidenceAdapterInvocation } from "./evidenceAdapter.js";
export type {
  SqlDialect,
  SqlDiagnostic,
  SqlDocumentCatalog,
  SqlLocator,
  SqlMigrationCandidate,
  SqlObjectEvidence,
  SqlParseOptions,
  SqlStatement,
} from "./sqlTypes.js";

export const SQL_EVIDENCE_ADAPTER_EXPORT =
  "sqlSourcesToEvidenceAdapterMaterialization";
