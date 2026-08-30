import type { SqlLocator, SqlObjectEvidence, SqlStatement } from "./sqlTypes.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function qualifiedName(value: unknown, preferredKey: "table" | "view" | "name" = "table"): string | null {
  if (typeof value === "string") return value;
  const item = record(value);
  if (item === null) return null;
  const rawName = item[preferredKey] ?? item.table ?? item.view ?? item.name;
  const name = typeof rawName === "string" ? rawName : record(rawName)?.value;
  if (typeof name !== "string") return null;
  const prefixes = [item.server, item.db, item.schema].filter((part): part is string => typeof part === "string" && part !== "null");
  return [...prefixes, name].join(".");
}

function names(value: unknown, preferredKey: "table" | "view" | "name" = "table"): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => qualifiedName(item, preferredKey) ?? []);
}

function parseVisitedTable(value: string): { operation: string; name: string } | null {
  const [operation, database, table] = value.split("::", 3);
  if (operation === undefined || table === undefined) return null;
  return { operation: operation.toLowerCase(), name: database === undefined || database === "null" ? table : `${database}.${table}` };
}

function addObject(input: {
  objects: SqlObjectEvidence[];
  statement: SqlStatement;
  locator: SqlLocator;
  kind: SqlObjectEvidence["object_kind"];
  name: string;
  operation: SqlObjectEvidence["operation"];
  ddlAction: string | null;
}): void {
  const key = `${input.kind}:${input.name}:${input.operation}:${input.ddlAction ?? "none"}`;
  if (input.objects.some((item) => `${item.object_kind}:${item.name}:${item.operation}:${item.ddl_action ?? "none"}` === key)) return;
  input.objects.push({
    object_ref: `${input.statement.statement_ref}:object:${input.objects.length + 1}`,
    object_kind: input.kind,
    name: input.name,
    operation: input.operation,
    ddl_action: input.ddlAction,
    statement_ref: input.statement.statement_ref,
    locator: { ...input.locator, qualified_item_path: `${input.locator.qualified_item_path}:object:${input.objects.length + 1}` },
  });
}

function addDdlObjects(ast: JsonRecord, statement: SqlStatement, locator: SqlLocator, objects: SqlObjectEvidence[]): void {
  const action = statement.statement_type;
  const keyword = typeof ast.keyword === "string" ? ast.keyword.toLowerCase() : "table";
  const kind: SqlObjectEvidence["object_kind"] = keyword === "view" || keyword === "index" ? keyword : "table";
  const source = kind === "view" ? ast.view ?? ast.name : kind === "index" ? ast.index ?? ast.name : ast.table ?? ast.name;
  for (const name of names(source, kind === "view" ? "view" : kind === "index" ? "name" : "table")) {
    addObject({ objects, statement, locator, kind, name, operation: "ddl", ddlAction: action });
  }
  if (kind === "index") {
    for (const name of names(ast.table)) addObject({ objects, statement, locator, kind: "table", name, operation: "ddl", ddlAction: "index-target" });
  }
}

export function sqlObjectsForStatement(input: {
  ast: unknown;
  tableList: readonly string[];
  statement: SqlStatement;
}): SqlObjectEvidence[] {
  const objects: SqlObjectEvidence[] = [];
  for (const entry of input.tableList) {
    const visited = parseVisitedTable(entry);
    if (visited === null) continue;
    const operation = visited.operation === "select"
      ? "read"
      : ["insert", "update", "delete", "replace", "merge"].includes(visited.operation)
        ? "write"
        : null;
    if (operation !== null) addObject({ objects, statement: input.statement, locator: input.statement.locator, kind: "table", name: visited.name, operation, ddlAction: null });
  }
  const ast = record(input.ast);
  if (ast !== null && input.statement.category === "ddl") addDdlObjects(ast, input.statement, input.statement.locator, objects);
  return objects;
}
