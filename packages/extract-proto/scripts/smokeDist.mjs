import { parseProtoSources, protoSourcesToEvidenceAdapterResult } from "../dist/index.js";

if (typeof protoSourcesToEvidenceAdapterResult !== "function") {
  throw new Error("extract-proto dist export is unavailable");
}

const document = parseProtoSources({
  "service.proto": "syntax = \"proto3\"; service Ready { rpc Check(A) returns (B); }",
})[0];
if (document?.services[0]?.methods[0]?.name !== "Check") {
  throw new Error("extract-proto dist parser did not produce the expected method");
}

console.log(JSON.stringify({ state: "extract-proto-dist-ready", node: process.version }));
