import { parseSqlSources, sqlSourcesToEvidenceAdapterResult } from "../dist/index.js";

if (typeof sqlSourcesToEvidenceAdapterResult !== "function") {
  throw new Error("extract-sql dist export is unavailable");
}

const document = parseSqlSources({ "ready.sql": "SELECT id FROM readiness;" }, { dialects: { "ready.sql": "sqlite" } })[0];
if (document?.objects[0]?.name !== "readiness") {
  throw new Error("extract-sql dist parser did not produce the expected table access");
}

console.log(JSON.stringify({ state: "extract-sql-dist-ready", node: process.version }));
