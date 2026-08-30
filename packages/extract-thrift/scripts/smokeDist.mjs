import { parseThriftSources, thriftSourcesToEvidenceAdapterResult } from "../dist/index.js";

if (typeof thriftSourcesToEvidenceAdapterResult !== "function") {
  throw new Error("extract-thrift dist export is unavailable");
}

const document = parseThriftSources({
  "service.thrift": "service Ready { bool Check() }",
})[0];
if (document?.services[0]?.methods[0]?.name !== "Check") {
  throw new Error("extract-thrift dist parser did not produce the expected method");
}

console.log(JSON.stringify({ state: "extract-thrift-dist-ready", node: process.version }));
