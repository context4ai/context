import { describe, expect, test } from "bun:test";
import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import {
  parseSqlSources,
  splitSqlStatements,
  sqlSourcesToEvidenceAdapterResult,
  type SqlEvidenceAdapterInvocation,
} from "../index.js";

const files = {
  "db/migrations/001_create_users.up.sql": `
-- schema migration
CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255));
CREATE INDEX idx_users_name ON users(name);
INSERT INTO users(id, name) VALUES (1, 'private-seed');
UPDATE users SET name = 'semicolon;inside' WHERE id = 1;
SELECT id, name FROM users;
`,
  "README.md": "not SQL",
} as const;

function invocation(sourceFiles: Readonly<Record<string, string>>, dialects: Readonly<Record<string, string>>): SqlEvidenceAdapterInvocation {
  return {
    adapter: {
      id: "extract-sql",
      package: "@c4a/extract-sql",
      export: "sqlSourcesToEvidenceAdapterResult",
      version: "0.7.0",
      digest: indexerEvidenceAdapterProtocolDigest("extract-sql@0.7.0"),
    },
    authorized_scope: {
      source_ref: "source:repository",
      module_refs: ["module:storage"],
      scope_digest: indexerEvidenceAdapterProtocolDigest("scope"),
    },
    input_digest: indexerEvidenceAdapterProtocolDigest(sourceFiles),
    precedence: 20,
    dialects,
    module_refs: Object.fromEntries(Object.keys(sourceFiles).map((path) => [path, "module:storage"])),
  };
}

describe("dialect-bound SQL lightweight evidence", () => {
  test("catalogs MySQL statements, table/index DDL, read/write access, migration identity, and locators", () => {
    const documents = parseSqlSources(files, { dialects: { "db/migrations/001_create_users.up.sql": "mysql" } });
    const migration = documents.find((document) => document.path.endsWith(".sql"))!;

    expect(migration).toMatchObject({ dialect: "mysql", disposition: "analyzed" });
    expect(migration.statements.map((statement) => [statement.statement_type, statement.category])).toEqual([
      ["create", "ddl"],
      ["create", "ddl"],
      ["insert", "write"],
      ["update", "write"],
      ["select", "read"],
    ]);
    expect(migration.statements.every((statement) => statement.statement_digest.startsWith("sha256:"))).toBe(true);
    expect(migration.statements.map((statement) => statement.locator.line)).toEqual([3, 4, 5, 6, 7]);
    expect(migration.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ object_kind: "table", name: "users", operation: "ddl", ddl_action: "create" }),
      expect.objectContaining({ object_kind: "index", name: "idx_users_name", operation: "ddl", ddl_action: "create" }),
      expect.objectContaining({ object_kind: "table", name: "users", operation: "ddl", ddl_action: "index-target" }),
      expect.objectContaining({ object_kind: "table", name: "users", operation: "write" }),
      expect.objectContaining({ object_kind: "table", name: "users", operation: "read" }),
    ]));
    expect(migration.migrations).toEqual([expect.objectContaining({ direction: "up", sequence: "001", basis: "path-convention" })]);
    expect(documents.find((document) => document.path === "README.md")?.disposition).toBe("excluded");
  });

  test("supports explicitly selected PostgreSQL and SQLite without a fallback dialect", () => {
    const inputs = {
      "db/view.sql": "CREATE VIEW active_users AS SELECT id FROM users;",
      "db/cleanup.sql": "DROP TABLE sessions; DELETE FROM users WHERE id = 1;",
    };
    const documents = parseSqlSources(inputs, { dialects: { "db/view.sql": "postgresql", "db/cleanup.sql": "sqlite" } });
    const view = documents.find((document) => document.path === "db/view.sql")!;
    const cleanup = documents.find((document) => document.path === "db/cleanup.sql")!;

    expect(view.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ object_kind: "view", name: "active_users", operation: "ddl" }),
      expect.objectContaining({ object_kind: "table", name: "users", operation: "read" }),
    ]));
    expect(cleanup.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ object_kind: "table", name: "sessions", operation: "ddl", ddl_action: "drop" }),
      expect.objectContaining({ object_kind: "table", name: "users", operation: "write" }),
    ]));
  });

  test("keeps transaction wrappers as control evidence around migration operations", () => {
    const input = { "db/transaction.sql": "BEGIN; UPDATE users SET active = 1; COMMIT;" };
    const document = parseSqlSources(input, { dialects: { "db/transaction.sql": "postgresql" } })[0]!;
    expect(document.disposition).toBe("analyzed");
    expect(document.statements.map((statement) => statement.category)).toEqual(["control", "write", "control"]);
    expect(document.objects).toEqual([expect.objectContaining({ name: "users", operation: "write" })]);
  });

  test("requires an explicit supported dialect and publishes no partial facts on syntax failure", () => {
    for (const [dialects, code] of [
      [{}, "sql-dialect-required"],
      [{ "db/query.sql": "oracle" }, "sql-dialect-unsupported"],
    ] as const) {
      const input = { "db/query.sql": "SELECT 1" };
      const result = sqlSourcesToEvidenceAdapterResult(input, invocation(input, dialects));
      expect(result.files[0]).toMatchObject({ disposition: "unsupported", facts: [] });
      expect(result.diagnostics[0]?.code).toBe(code);
    }

    const broken = { "db/broken.sql": "SELECT * FROM" };
    const result = sqlSourcesToEvidenceAdapterResult(broken, invocation(broken, { "db/broken.sql": "postgresql" }));
    expect(result.files[0]).toMatchObject({ disposition: "unsupported", facts: [] });
    expect(result.diagnostics[0]?.code).toBe("sql-source-unsupported");

    const unclosed = { "db/unclosed.sql": "/* unfinished" };
    const unclosedResult = sqlSourcesToEvidenceAdapterResult(unclosed, invocation(unclosed, { "db/unclosed.sql": "mysql" }));
    expect(unclosedResult.files[0]).toMatchObject({ disposition: "unsupported", facts: [] });
    expect(unclosedResult.diagnostics[0]?.code).toBe("sql-source-unsupported");
  });

  test("publishes only lightweight facts and never serializes SQL literals", () => {
    const dialects = { "db/migrations/001_create_users.up.sql": "mysql" };
    const result = sqlSourcesToEvidenceAdapterResult(files, invocation(files, dialects));
    const migration = result.files.find((file) => file.normalized_path.endsWith(".sql"))!;
    const serialized = JSON.stringify(result);

    expect(migration.coverage_tier).toBe("lightweight-evidence");
    expect(migration.facts.length).toBeGreaterThan(0);
    expect(migration.facts.every((fact) => fact.denominator === "none")).toBe(true);
    expect(migration.facts.some((fact) => fact.kind === "sql-statement")).toBe(true);
    expect(migration.facts.some((fact) => fact.kind === "sql-object")).toBe(true);
    expect(migration.facts.some((fact) => fact.kind === "sql-migration-candidate")).toBe(true);
    expect(serialized).not.toContain("private-seed");
    expect(serialized).not.toContain("semicolon;inside");
  });

  test("splits semicolons only outside quotes, comments, and PostgreSQL dollar bodies", () => {
    const statements = splitSqlStatements(`
SELECT 'a;b';
-- ; comment
SELECT 2 /* ; nested /* ; */ comment */;
CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END; $$ LANGUAGE plpgsql;
`);
    expect(statements).toHaveLength(3);
    expect(statements.map((statement) => statement.line)).toEqual([2, 4, 5]);
    expect(statements[2]?.text).toContain("PERFORM 1; END;");
  });

  test("rejects non-portable registered paths", () => {
    expect(() => parseSqlSources({ "../query.sql": "SELECT 1" }, { dialects: { "../query.sql": "mysql" } })).toThrow("not portable");
  });
});
