import { configSourcesToEvidenceAdapterResult, parseConfigSources } from "../dist/index.js";

if (typeof configSourcesToEvidenceAdapterResult !== "function") {
  throw new Error("extract config evidence dist export is unavailable");
}

const document = parseConfigSources({ "config/readiness.yaml": "runtime:\n  port: 8080\n" })[0];
const port = document?.values.find((value) => value.key_path.join(".") === "runtime.port");
if (port?.boundary_candidate !== "runtime" || port.value_type !== "number") {
  throw new Error("extract config evidence dist parser did not produce the expected runtime candidate");
}

console.log(JSON.stringify({ state: "extract-config-dist-ready", node: process.version }));
