import { indexGoSource } from "../dist/index.js";

const indexed = indexGoSource(
  "package smoke\n\nfunc Ready() bool { return true }\n",
  "ready.go",
);

if (indexed.parseErrors !== 0 || indexed.symbols[0]?.qualifiedName !== "Ready") {
  throw new Error(`Unexpected published Go extraction result: ${JSON.stringify(indexed)}`);
}

console.log(JSON.stringify({
  state: "extract-go-dist-ready",
  node: process.version,
  symbol: indexed.symbols[0].qualifiedName,
}));
