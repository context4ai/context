# @c4a/extract-ts

[简体中文](./README.zh-CN.md)

`@c4a/extract-ts` turns TypeScript, JavaScript, TSX, and JSX structure into deterministic code
evidence for Context knowledge production. It implements the
`ExtractionPlugin` protocol from `@c4a/extract` and is the community Code
Indexer Provider's ECMAScript parser for npm-style packages.

It extracts code facts; it does not decide product meaning, write approved
Markdown, or choose the user's source boundary. Knowledge-workspace users reach
it through the selected Code Indexer Provider. The direct APIs below are for
Provider authors and reusable structural analysis.

## Package Role

`@c4a/extract-ts` handles npm package entry detection and ECMAScript-family AST extraction. It does not write `.context` files directly; `@c4a/extract` runs the plugin and `@c4a/context-cli` persists the resulting raw code snapshot.

**Depends on:** `@c4a/extract`, `typescript`, `web-tree-sitter`

```text
confirmed TypeScript/JavaScript boundary
          ↓
entry detection + export tracing + AST facts
          ↓
Indexer facts → reader-oriented Candidates → approved knowledge
```

## React Router structural facts

Indexer Providers can reuse `extractReactRouterRoutes()` to
index JSX `<Route>` declarations and route-object arrays. It reports paths,
components, redirects, conditions, import sources, notes, and source locations
without classifying product meaning:

```ts
import { extractReactRouterRoutes } from "@c4a/extract-ts";

const routes = extractReactRouterRoutes(source, "src/router.tsx", {
  routeIdPrefix: "web",
  mountPath: "/web",
});
```

## TypeScript module export facts

`extractTypeScriptModuleExports()` reads one TypeScript or TSX module and
returns deterministic named exports, wildcard export targets, and all
re-export targets. It does not resolve files or infer product meaning:

```ts
import { extractTypeScriptModuleExports } from "@c4a/extract-ts";

const exports = extractTypeScriptModuleExports(source, "src/index.ts");
```

`extractEcmaScriptModuleExports()` is the format-neutral API for `.ts`, `.tsx`,
`.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs`. In addition to ESM exports,
it recognizes static CommonJS `require`, `exports.name`, `module.exports.name`,
and object/wildcard `module.exports` forms. Its result declares the
`ast-catalog` coverage tier, parser capabilities, and an `analyzed` or
`unsupported` disposition with file-local diagnostics:

```ts
import { extractEcmaScriptModuleExports } from "@c4a/extract-ts";

const moduleFacts = extractEcmaScriptModuleExports(source, "src/index.cjs");
```

## Current Extraction Coverage

### Entry Detection

`detectEntries()` reads `package.json` and supports:

- `exports` maps, including conditional `import`, `default`, and `main` targets
- `main`
- `bin`
- `workspaces` globs ending in `/*`
- `dist/` to `src/` source-path fallback through `resolveEntrySourcePath()`
- package kind classification: `lib`, `cli`, or `service`
- package version propagation into `ExtractionResult.package.version`
- authored `.js`, `.jsx`, `.mjs`, and `.cjs` entry files without remapping them to TypeScript

The Code Indexer Provider may override auto-detection with source-relative
entries, or use scan mode to make every include-matched file an extraction
root. Consumers do not modify the analyzed package solely to configure parsing.

Entry files are returned as module-relative paths. The repository runner later prefixes them to repo-relative paths in raw snapshots.

### Symbol Extraction

`extractSymbols()` starts from detected entry files, traces exports, and marks reachable declarations as `exported`.

It currently extracts:

- functions
- classes
- interfaces
- type aliases
- enums
- variables
- TSX/JSX component-like functions and variables
- hook-like functions by name in downstream projection
- class/interface/type members as nested symbols
- JSDoc on declarations and members
- function params and return types
- type annotations
- interface/type object members, including object types nested in union/intersection/parenthesized types
- string-literal union values
- component `propsType` by `FC<Props>` style annotations or `{ComponentName}Props` convention

It emits relations for:

- `imports`
- `imports_type`
- `extends`
- `implements`
- `param_type`
- `return_type`
- `of_type`
- `calls`

All emitted relations are code-grounded AST relations with confidence `1`.

### Export Tracing

`exportTracer.ts` follows:

- local exported declarations
- `export default <identifier>` when the identifier is locally declared
- `export * from "./module"`
- `export { A } from "./module"`
- aliased export specifiers
- circular re-export chains through an in-flight guard
- static CommonJS `require` bindings and `exports` / `module.exports` assignments

Only declarations reachable through entries are marked `exported`; other declarations in traced files remain `internal`.

## Contract with Code Projection

The plugin returns `ExtractionResult` v2. The `@c4a/extract` runner turns that into raw snapshot rows:

- `packages.jsonl` receives package name/kind/language/version and package description when present.
- `symbols.jsonl` receives flattened symbol rows with `symbol_id`, `package_name`, and `module_path`.
- `edges.jsonl` receives relation rows with package/module/version/hash metadata.
- `digests.jsonl` receives versioned module digest rows.

The durable digest also retains `coverage.tier`, the complete capability list,
and a disposition for every reached file. Syntax errors, dynamic CommonJS
module names, and dynamic CommonJS export keys are `unsupported`; they include
a stable file/line/column diagnostic and do not publish partial symbols from
that file.

`typeScriptExtractionToEvidenceAdapterResult()` is the Indexer-facing export.
It converts only `c4a-extract-ts` output and publishes canonical file/fact
identities, per-file owner/disposition, explicit denominators, diagnostics, and
the ordered parser receipt through `context.indexer.evidence-adapter-result/v1`.
`ExtractionResult` remains available for the existing raw snapshot runner.

The Code Indexer Provider consumes those facts while producing the current
Indexer result. Important authoring inputs include:

- stable package names and versions
- stable exported symbol names
- useful `kind` values (`component`, `function`, `type`, `interface`, etc.)
- accurate visibility
- source file and line ranges
- relation `from` / `to` values
- JSDoc and type/member metadata

Package build reads approved Markdown and generated project metadata after
review/apply and close; it does not read `@c4a/extract-ts` output directly.

## Usage

Manual registry usage:

```ts
import { ExtractionPluginRegistry } from "@c4a/extract";
import { TypeScriptPlugin } from "@c4a/extract-ts";

const registry = new ExtractionPluginRegistry();
registry.register(new TypeScriptPlugin());
```

Workspace usage registers the source boundary, then selects the Code Indexer
Provider through `src/indexers.yaml`:

```bash
context source add repo component-lib --local ../packages/component-lib
context status --format json
```

Agents should not hand-build parser input, raw snapshots, or Candidate files
for normal Context workspace operation.

## Development

```bash
bun run --filter @c4a/extract-ts build
bun run --filter @c4a/extract-ts typecheck
bun run --filter @c4a/extract-ts test
bun run --filter @c4a/extract-ts lint
bun run test:dist
```
