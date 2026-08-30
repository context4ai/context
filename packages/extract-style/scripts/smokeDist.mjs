import { parseStyleSources, styleSourcesToEvidenceAdapterResult } from "../dist/index.js";

if (typeof styleSourcesToEvidenceAdapterResult !== "function") {
  throw new Error("extract-style dist export is unavailable");
}

const document = parseStyleSources({ "Ready.module.css": ".Ready:hover { --state: ready; }" })[0];
if (document?.variants_and_states[0]?.name !== "hover") {
  throw new Error("extract-style dist parser did not produce the expected state");
}

console.log(JSON.stringify({ state: "extract-style-dist-ready", node: process.version }));
