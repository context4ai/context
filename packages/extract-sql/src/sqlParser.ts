import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import { Parser as MySqlParser } from "node-sql-parser/build/mysql";
import { Parser as PostgreSqlParser } from "node-sql-parser/build/postgresql";
import { Parser as SqliteParser } from "node-sql-parser/build/sqlite";
import { sqlObjectsForStatement } from "./sqlObjects.js";
import { splitSqlStatements } from "./sqlStatements.js";
import type {
  SqlDialect,
  SqlDocumentCatalog,
  SqlMigrationCandidate,
  SqlParseOptions,
  SqlStatement,
} from "./sqlTypes.js";

type JsonRecord = Record<string, unknown>;
const PARSER_FACTORIES: Readonly<Record<SqlDialect, () => MySqlParser>> = {
  mysql: () => new MySqlParser(),
  postgresql: () => new PostgreSqlParser(),
  sqlite: () => new SqliteParser(),
};

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function portablePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

function empty(path: string, disposition: SqlDocumentCatalog["disposition"]): SqlDocumentCatalog {
  return { path, dialect: null, disposition, statements: [], objects: [], migrations: [], diagnostics: [] };
}

function dialect(value: string | undefined): SqlDialect | null {
  const normalized = value?.toLowerCase();
  return normalized !== undefined && Object.hasOwn(PARSER_FACTORIES, normalized) ? normalized as SqlDialect : null;
}

function statementCategory(type: string): SqlStatement["category"] | null {
  if (type === "select") return "read";
  if (["insert", "update", "delete", "replace", "merge"].includes(type)) return "write";
  if (["create", "alter", "drop", "truncate", "rename"].includes(type)) return "ddl";
  if (["transaction", "set", "use"].includes(type)) return "control";
  return null;
}

function migrationCandidate(path: string): SqlMigrationCandidate | null {
  const basename = path.split("/").at(-1) ?? path;
  const conventional = /(?:^|\/)(?:migrations?|migrate)(?:\/|$)/iu.test(path) || /^(?:V)?[0-9]+.*\.sql$/iu.test(basename) || /\.(?:up|down)\.sql$/iu.test(basename);
  if (!conventional) return null;
  const direction = /(?:^|[./_-])down(?:[./_-]|$)/iu.test(path)
    ? "down" as const
    : /(?:^|[./_-])up(?:[./_-]|$)/iu.test(path) ? "up" as const : "unknown" as const;
  const sequence = /^(?:V)?([0-9]+(?:[._-][0-9]+)*)/iu.exec(basename)?.[1] ?? null;
  return {
    migration_ref: `${path}#migration:path-convention`,
    direction,
    sequence,
    basis: "path-convention",
    locator: { path, line: 1, column: 1, qualified_item_path: "migration:path-convention" },
  };
}

function parseSqlDocument(path: string, source: string, dialectName: SqlDialect): SqlDocumentCatalog {
  const document = empty(path, "analyzed");
  document.dialect = dialectName;
  const migration = migrationCandidate(path);
  if (migration !== null) document.migrations.push(migration);
  const parser = PARSER_FACTORIES[dialectName]();
  let sourceStatements: ReturnType<typeof splitSqlStatements>;
  try {
    sourceStatements = splitSqlStatements(source);
  } catch (error) {
    document.disposition = "unsupported";
    document.diagnostics.push({ code: "sql-source-unsupported", severity: "error", locator: { path, line: 1, column: 1, qualified_item_path: "file" }, detail: error instanceof Error ? error.message : String(error) });
    return document;
  }
  for (const [statementIndex, sourceStatement] of sourceStatements.entries()) {
    const ordinal = statementIndex + 1;
    const locator = { path, line: sourceStatement.line, column: sourceStatement.column, qualified_item_path: `statement:${ordinal}` };
    let parsed: ReturnType<MySqlParser["parse"]>;
    try {
      parsed = parser.parse(sourceStatement.text, { parseOptions: { includeLocations: true } });
    } catch (error) {
      document.disposition = "unsupported";
      document.diagnostics.push({ code: "sql-source-unsupported", severity: "error", locator, detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const astValues = Array.isArray(parsed.ast) ? parsed.ast : [parsed.ast];
    if (astValues.length === 0) continue;
    if (astValues.length !== 1) {
      document.disposition = "unsupported";
      document.diagnostics.push({ code: "sql-source-unsupported", severity: "error", locator, detail: "one lexical SQL statement produced multiple AST roots" });
      continue;
    }
    const ast = astValues[0];
    const type = typeof record(ast)?.type === "string" ? String(record(ast)!.type).toLowerCase() : "unknown";
    const category = statementCategory(type);
    if (category === null) {
      document.disposition = "unsupported";
      document.diagnostics.push({ code: "sql-statement-unsupported", severity: "error", locator, detail: `unsupported SQL statement type: ${type}` });
      continue;
    }
    const statement: SqlStatement = {
      statement_ref: `${path}#statement:${ordinal}`,
      dialect: dialectName,
      statement_type: type,
      category,
      statement_digest: indexerEvidenceAdapterProtocolDigest({ dialect: dialectName, source: sourceStatement.text }),
      locator,
    };
    document.statements.push(statement);
    document.objects.push(...sqlObjectsForStatement({ ast, tableList: parsed.tableList, statement }));
  }
  return document;
}

/** Parses registered `.sql` files only when the caller supplies an explicit supported dialect. */
export function parseSqlSources(files: Readonly<Record<string, string>>, options: SqlParseOptions): SqlDocumentCatalog[] {
  const entries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
  for (const [path, source] of entries) {
    if (!portablePath(path)) throw new TypeError(`SQL source path is not portable: ${path}`);
    if (typeof source !== "string") throw new TypeError(`SQL source must be text: ${path}`);
  }
  return entries.map(([path, source]) => {
    if (!/\.sql$/iu.test(path)) return empty(path, "excluded");
    const configured = options.dialects[path];
    const selected = dialect(configured);
    if (selected !== null) return parseSqlDocument(path, source, selected);
    const document = empty(path, "unsupported");
    document.diagnostics.push({
      code: configured === undefined ? "sql-dialect-required" : "sql-dialect-unsupported",
      severity: "error",
      locator: { path, line: 1, column: 1, qualified_item_path: "file" },
      detail: configured === undefined ? "SQL dialect must be declared by the caller" : `unsupported SQL dialect: ${configured}`,
    });
    return document;
  });
}
