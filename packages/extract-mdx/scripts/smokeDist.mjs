import { parseMdxSources } from "../dist/index.js";

const document = parseMdxSources({
  "examples/ready.mdx": "import {Ready} from '@fixture/ui'\n\n<Ready />",
}, {
  public_targets: [{
    target_ref: "public-target:ready",
    export_name: "Ready",
    source_module: "@fixture/ui",
  }],
})[0];

if (document?.components[0]?.target_ref !== "public-target:ready") {
  throw new Error("extract-mdx dist parser did not link the expected public target");
}

console.log(JSON.stringify({ state: "extract-mdx-dist-ready", node: process.version }));
