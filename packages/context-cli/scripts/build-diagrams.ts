import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist/browser");
await mkdir(output, { recursive: true });
// ELK's CommonJS worker fallback needs browser-aware bundling; this also retains
// third-party license comments in the self-contained Review artifact.
const result = await build({ entryPoints: [resolve(root, "src/project/diagramBrowser.ts")],
  platform: "browser", target: "es2022", format: "iife", bundle: true, minify: true,
  splitting: false, write: false, legalComments: "inline" });
const source = result.outputFiles[0]!.text.replace(/<\/script/giu, "<\\/script");
await writeFile(resolve(output, "diagrams.js"), source);
console.log(`Offline diagram viewer: ${Buffer.byteLength(source)} bytes`);
