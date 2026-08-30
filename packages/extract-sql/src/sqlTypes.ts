export type SqlDialect = "mysql" | "postgresql" | "sqlite";

export interface SqlLocator {
  path: string;
  line: number;
  column: number;
  qualified_item_path: string;
}

export interface SqlStatement {
  statement_ref: string;
  dialect: SqlDialect;
  statement_type: string;
  category: "read" | "write" | "ddl" | "control";
  statement_digest: string;
  locator: SqlLocator;
}

export interface SqlObjectEvidence {
  object_ref: string;
  object_kind: "table" | "view" | "index";
  name: string;
  operation: "read" | "write" | "ddl";
  ddl_action: string | null;
  statement_ref: string;
  locator: SqlLocator;
}

export interface SqlMigrationCandidate {
  migration_ref: string;
  direction: "up" | "down" | "unknown";
  sequence: string | null;
  basis: "path-convention";
  locator: SqlLocator;
}

export interface SqlDiagnostic {
  code:
    | "sql-dialect-required"
    | "sql-dialect-unsupported"
    | "sql-source-unsupported"
    | "sql-statement-unsupported";
  severity: "error";
  locator: SqlLocator;
  detail: string;
}

export interface SqlDocumentCatalog {
  path: string;
  dialect: SqlDialect | null;
  disposition: "analyzed" | "unsupported" | "excluded";
  statements: SqlStatement[];
  objects: SqlObjectEvidence[];
  migrations: SqlMigrationCandidate[];
  diagnostics: SqlDiagnostic[];
}

export interface SqlParseOptions {
  dialects: Readonly<Record<string, string>>;
}
