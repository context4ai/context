/**
 * Shared build script for packages that depend on MikroORM/knex.
 *
 * knex bundles optional database dialects that call `require("pg")`,
 * `require("mysql2")` etc. These packages are not installed and must
 * be marked as external so bun-build skips them. Maintaining the same
 * long `--external` list in every package.json is error-prone, so this
 * script centralises it.
 *
 * Usage in package.json:
 *   "build": "bun run ../../scripts/build.ts src/index.ts"
 *
 * Flags after the entry points:
 *   --shebang         Prepend #!/usr/bin/env node and chmod +x (for CLI bins)
 *   --shebang=bun     Prepend #!/usr/bin/env bun and chmod +x
 *   --shebang-entry   Restrict shebang/chmod to one entrypoint
 */

import { existsSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Dependencies that must stay external during bundling.
// Native addons (.node files) cannot be inlined by Bun.build(); they must
// be resolved from node_modules at runtime. sqlite3 is actively used by
// C4A; the rest are optional drivers that knex/MikroORM try to require().
const RUNTIME_EXTERNALS = [
  "sqlite3",
  "better-sqlite3",
  "oracledb",
  "libsql",
  "mysql",
  "mysql2",
  "mariadb",
  "pg",
  "pg-query-stream",
  "pg-native",
  "tedious",
  // @duckdb/node-api depends on @duckdb/node-bindings which loads
  // platform-specific native addons. Keep the whole chain external so
  // the dynamic require() resolves correctly at runtime.
  "@duckdb/node-api",
  "@duckdb/node-bindings",
  "@duckdb/node-bindings-darwin-arm64",
  "@duckdb/node-bindings-darwin-x64",
  "@duckdb/node-bindings-linux-arm64",
  "@duckdb/node-bindings-linux-x64",
  "@duckdb/node-bindings-win32-arm64",
  "@duckdb/node-bindings-win32-x64",
  "@huggingface/transformers",
  "@xenova/transformers",
  "onnxruntime-node",
  // vectordb (LanceDB) bundles platform-specific native addons via
  // @lancedb/vectordb-<platform>. Keep the whole package external so
  // the dynamic require() inside vectordb resolves correctly at runtime.
  "vectordb",
  "@zilliz/milvus2-sdk-node",
  "@lancedb/vectordb-darwin-arm64",
  "@lancedb/vectordb-darwin-x64",
  "@lancedb/vectordb-linux-arm64-gnu",
  "@lancedb/vectordb-linux-x64-gnu",
  "@lancedb/vectordb-win32-x64-msvc",
  // vite is only used at dev-time via dynamic import in serve.ts (C4A_DEV=1).
  // Must stay external so Bun.build() doesn't try to bundle it.
  "vite",
  // ws (WebSocket client) must stay external when running under bun runtime.
  // bun's native WebSocket conflicts with the bundled ws package.
  "ws",
  // jiti resolves its Babel transform helper relative to its own package
  // directory. Inlining jiti moves that relative lookup into the generated
  // CLI bundle, which breaks when dist/ is flattened for npm publishing.
  // Keep jiti external so dev, link, and npm modes all load its own dist
  // assets through the declared runtime dependency.
  "jiti",
  // web-tree-sitter resolves its core WASM relative to the installed package.
  // Inlining the CommonJS package bakes the build machine's node_modules path
  // into generated bundles and makes that fallback unusable after publishing.
  "web-tree-sitter",
  // Native Tree-sitter grammars must be resolved from their installed
  // packages. The Go plugin stays a runtime package for the same reason.
  "tree-sitter",
  "tree-sitter-go",
  // TypeScript is a declared runtime dependency of packages that use its AST.
  "typescript",
];

const args = process.argv.slice(2);
const shebangArg = args.find((arg) => arg === "--shebang" || arg.startsWith("--shebang="));
const shebangValue = shebangArg?.includes("=") ? shebangArg.split("=")[1] : undefined;
const shouldShebang = Boolean(shebangArg);
const shebangKind = shebangValue === "bun" ? "bun" : "node";
const shebangEntryArg = args.find((arg) => arg.startsWith("--shebang-entry="));
const shebangEntry = shebangEntryArg?.split("=")[1];
const shebangOutputBase = shebangEntry
  ? basename(shebangEntry).replace(/\.[cm]?tsx?$/, ".js")
  : null;
const entrypoints = args.filter((a) => !a.startsWith("--"));

if (entrypoints.length === 0) {
  console.error("Usage: bun run scripts/build.ts <entry...> [--shebang|--shebang=bun]");
  process.exit(1);
}

const result = await Bun.build({
  entrypoints,
  outdir: "dist",
  target: "node",
  format: "esm",
  external: RUNTIME_EXTERNALS,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

for (const output of result.outputs) {
  console.log(`  ${basename(output.path)}  ${(output.size / 1024 / 1024).toFixed(2)} MB`);
}

// Post-process: fix eval'd require in bundled ESM output.
// Bun.build() emits `var __require = createRequire(import.meta.url)` but names
// it `__require`, not `require`. Libraries like protobufjs use
// `eval("require")("buffer")` to probe for optional modules — this resolves
// the name `require` at runtime, which doesn't exist in ESM scope.
// Alias `require` to `__require` so these eval'd calls work correctly.
//
// Why eval'd require exists: protobufjs (used by gRPC/LanceDB) calls
// eval("require")("buffer") to detect optional native modules without
// triggering bundler static analysis. Without this alias the call throws
// "require is not defined" in ESM, crashing at import time.
for (const output of result.outputs) {
  if (!existsSync(output.path)) continue;
  let content = await readFile(output.path, "utf-8");
  const needle = "var __require = /* @__PURE__ */ createRequire(import.meta.url);";
  if (content.includes(needle) && !content.includes("var require = __require;")) {
    content = content.replace(needle, `${needle}\nvar require = __require;`);
    await writeFile(output.path, content);
  }
}

const copyWasmDir = async (sourceDir: string) => {
  if (!existsSync(sourceDir)) return;
  const sourceStats = await stat(sourceDir).catch(() => null);
  if (!sourceStats || !sourceStats.isDirectory()) return;

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const targetDir = join(process.cwd(), "dist", "wasm");
  await mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (extname(entry.name) !== ".wasm") continue;
    const from = join(sourceDir, entry.name);
    const to = join(targetDir, entry.name);
    await copyFile(from, to);
  }
};

const copyWasmAssets = async () => {
  await copyWasmDir(join(process.cwd(), "src", "wasm"));
  const packagesDir = dirname(fileURLToPath(import.meta.url));

  const packageJsonPath = join(process.cwd(), "package.json");
  if (!existsSync(packageJsonPath)) return;
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    c4aBuild?: { assets?: string[] };
  };
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
  };
  // Packages that inline @c4a/extract must declare the grammar assets they
  // consume. Package dependencies alone are insufficient: extractor plugins
  // may import only its TypeScript contracts and must not inherit unrelated
  // language assets. The extract package itself copies src/wasm above.
  const needsExtractWasm = packageJson.c4aBuild?.assets?.includes("extract-wasm") ?? false;
  if (needsExtractWasm) {
    await copyWasmDir(join(packagesDir, "extract", "src", "wasm"));
  }

  // Both direct users of web-tree-sitter (notably @c4a/extract itself) and
  // packages that inline @c4a/extract need the core runtime WASM beside their
  // generated bundle. This keeps dev, link, and npm execution equivalent.
  const needsTreeSitterRuntime = needsExtractWasm || Boolean(dependencies["web-tree-sitter"]);
  if (!needsTreeSitterRuntime) return;

  // Copy tree-sitter.wasm (core WASM runtime) from node_modules at build time.
  // This avoids committing binary files to the repo.
  //
  // Resolve from the package that declares web-tree-sitter so its JS runtime
  // and copied WASM always have the same version. Packages that only inline
  // @c4a/extract resolve through extract's declaration instead.
  const targetDir = join(process.cwd(), "dist", "wasm");
  await mkdir(targetDir, { recursive: true });
  const treeSitterTarget = join(targetDir, "tree-sitter.wasm");
  if (!existsSync(treeSitterTarget)) {
    const { createRequire } = await import("node:module");
    const dependencyOwner = dependencies["web-tree-sitter"]
      ? packageJsonPath
      : join(packagesDir, "extract", "package.json");
    const req = createRequire(dependencyOwner);
    try {
      const pkgDir = dirname(req.resolve("web-tree-sitter"));
      const src = join(pkgDir, "tree-sitter.wasm");
      if (existsSync(src)) {
        await copyFile(src, treeSitterTarget);
      }
    } catch {
      // web-tree-sitter not resolvable, skip
    }
  }
};

await copyWasmAssets();

// CLI packages ship workspace templates as runtime assets. Bun.build() only
// emits bundled JS, so copy templates into dist for link/npm execution.
const copyTemplatesAssets = async () => {
  const sourceDir = join(process.cwd(), "templates");
  const targetDir = join(process.cwd(), "dist", "templates");
  await rm(targetDir, { recursive: true, force: true });
  if (!existsSync(sourceDir)) return;
  const sourceStats = await stat(sourceDir).catch(() => null);
  if (!sourceStats || !sourceStats.isDirectory()) return;
  await cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
  });
  console.log("  templates → dist/templates/");
};

await copyTemplatesAssets();

// CLI packages can ship user-facing docs as runtime assets. Keep the source
// docs in the package root and publish them under dist/docs so installed users
// can find the quickstart from `context --help`.
const copyDocsAssets = async () => {
  const sourceDir = join(process.cwd(), "docs");
  const targetDir = join(process.cwd(), "dist", "docs");
  await rm(targetDir, { recursive: true, force: true });
  if (!existsSync(sourceDir)) return;
  const sourceStats = await stat(sourceDir).catch(() => null);
  if (!sourceStats || !sourceStats.isDirectory()) return;
  await cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
  });
  console.log("  docs → dist/docs/");
};

await copyDocsAssets();

if (shouldShebang) {
  // Prepend shebang to each output file (strip any existing shebang first)
  for (const output of result.outputs) {
    const target = output.path;
    if (!target || !existsSync(target)) continue;
    if (shebangOutputBase && basename(target) !== shebangOutputBase) continue;
    let content = await readFile(target, "utf-8");
    while (content.startsWith("#!")) {
      content = content.slice(content.indexOf("\n") + 1);
    }
    await writeFile(target, `#!/usr/bin/env ${shebangKind}\n${content}`);
    await chmod(target, 0o755);
  }

  // Generate dist/package.json for CLI packages to ensure version consistency.
  // bun link creates its own dist/package.json which can become stale;
  // overwrite it with current version from source package.json.
  const srcPkgPath = join(process.cwd(), "package.json");
  if (existsSync(srcPkgPath)) {
    const srcPkg = JSON.parse(await readFile(srcPkgPath, "utf-8")) as {
      name?: string;
      version?: string;
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const publishDependencies = srcPkg.dependencies === undefined
      ? undefined
      : Object.fromEntries(Object.entries(srcPkg.dependencies).map(([name, version]) => [
          name,
          version.startsWith("workspace:") ? srcPkg.version : version,
        ]));
    const distPkg = {
      name: srcPkg.name,
      version: srcPkg.version,
      type: "module",
      bin: srcPkg.bin
        ? Object.fromEntries(
            Object.entries(srcPkg.bin).map(([k, v]) => [
              k,
              v.replace(/^\.\/dist\//, "./").replace(/\.ts$/, ".js"),
            ]),
          )
        : undefined,
      dependencies: publishDependencies,
      scripts: srcPkg.scripts?.postinstall === undefined
        ? undefined
        : { postinstall: srcPkg.scripts.postinstall.replace(/^node scripts\//, "node scripts/") },
    };
    await writeFile(join(process.cwd(), "dist", "package.json"), JSON.stringify(distPkg, null, 2) + "\n");
  }
}
