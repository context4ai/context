import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const crate = resolve(root, "../context-evidence-wasm");
const cargo = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--format-version", "1"], { cwd: crate, encoding: "utf8" }));
const remaps = cargo.packages.map((pkg: { manifest_path: string; name: string; version: string }) =>
  `--remap-path-prefix=${dirname(pkg.manifest_path)}=/sources/${pkg.name}-${pkg.version}`);
execFileSync("cargo", ["build", "--locked", "--release", "--target", "wasm32-unknown-unknown"], {
  cwd: crate, stdio: "inherit", env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: remaps.join("\x1f") },
});
const bytes = await readFile(resolve(crate, "target/wasm32-unknown-unknown/release/context_evidence_wasm.wasm"));
const module = new WebAssembly.Module(bytes);
const metadata = WebAssembly.Module.customSections(module, "sourcegraph.plugin.v1");
const declaration = metadata.length === 1 ? JSON.parse(new TextDecoder().decode(metadata[0])) : undefined;
if (declaration?.name !== "context-evidence" || declaration.abi_version !== 2) {
  throw new Error("Missing evidence plugin metadata");
}
const imports = WebAssembly.Module.imports(module);
if (imports.some(item => item.module !== "sourcegraph" || !["read_file", "last_error"].includes(item.name))) {
  throw new Error("Unexpected evidence plugin imports");
}
const output = resolve(root, "dist/evidence");
await mkdir(output, { recursive: true });
const license = await readFile(resolve(root, "../../LICENSE"), "utf8");
await writeFile(resolve(output, "LICENSE"), license);
// Retain dependency licenses in the distributed tool, not runtime registry paths.
const notices: string[] = [license];
for (const pkg of cargo.packages) {
  if (pkg.name === "context-evidence-wasm") continue;
  notices.push(`${pkg.name} ${pkg.version} — ${pkg.license ?? "See license below"}`);
  for (const file of (await readdir(dirname(pkg.manifest_path))).sort()) {
    if (/^(LICENSE|COPYING|NOTICE)([.-]|$)/iu.test(file)) {
      try { notices.push(await readFile(resolve(dirname(pkg.manifest_path), file), "utf8")); } catch { /* license directory */ }
    }
  }
}
await writeFile(resolve(output, "THIRD-PARTY-NOTICES.txt"), notices.join("\n\n"));
// A knowledge repository redistributes a single Wasm: embed the notices so they
// travel with the binary, not only with the CLI used to install it.
function leb(value: number): Buffer {
  const result: number[] = [];
  do { const byte = value & 127; value >>>= 7; result.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(result);
}
const sectionName = Buffer.from("context.licenses");
const section = Buffer.concat([leb(sectionName.length), sectionName, Buffer.from(notices.join("\n\n"))]);
const artifact = Buffer.concat([bytes, Buffer.from([0]), leb(section.length), section]);
if (!WebAssembly.validate(artifact)) throw new Error("Invalid evidence Wasm artifact");
await writeFile(resolve(output, "context-evidence.sourcegraph.wasm"), artifact);
const previous = JSON.parse(await readFile(resolve(crate, "official-digests.json"), "utf8")) as string[];
await writeFile(resolve(output, "manifest.json"), `${JSON.stringify({ sha256: createHash("sha256").update(artifact).digest("hex"), previous }, null, 2)}\n`);
console.log(`Evidence Wasm: ${artifact.length} bytes`);
