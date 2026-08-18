import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(process.argv[2] ?? ".");
const source = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as Record<string, unknown> & {
  dependencies?: Record<string, string>;
};
const dependencies = Object.fromEntries(
  Object.entries(source.dependencies ?? {}).filter(([, version]) => !version.startsWith("workspace:")),
);
const manifest: Record<string, unknown> = {
  name: source.name,
  version: source.version,
  type: "module",
  main: "./index.js",
  exports: { ".": "./index.js" },
};
for (const field of ["description", "license", "repository", "keywords", "engines"] as const) {
  if (source[field] !== undefined) manifest[field] = source[field];
}
if (Object.keys(dependencies).length > 0) manifest.dependencies = dependencies;
await writeFile(path.join(packageRoot, "dist", "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
