import { contractSourcesToEvidenceAdapterResult, parseContractSources } from "../dist/index.js";

if (typeof contractSourcesToEvidenceAdapterResult !== "function") {
  throw new Error("extract-contract dist export is unavailable");
}

const document = parseContractSources({
  "api.yaml": "openapi: '3.1.0'\ninfo: { title: Ready, version: '1' }\npaths: { /ready: { get: { operationId: ready } } }",
})[0];
if (document?.operations[0]?.name !== "ready") {
  throw new Error("extract-contract dist parser did not produce the expected operation");
}

console.log(JSON.stringify({ state: "extract-contract-dist-ready", node: process.version }));
