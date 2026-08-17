# @c4a/extract-ts

TypeScript/TSX extraction plugin for Context. It implements the
`ExtractionPlugin` protocol from `@c4a/extract` and is the default plugin used
by the SDK `extractTs({ source, collection: "codegraph" })` phase for npm-style
packages.

## Package Role

`@c4a/extract-ts` handles TypeScript package entry detection and AST extraction. It does not write `.context` files directly; `@c4a/extract` runs the plugin and `@c4a/context-cli` persists the resulting raw code snapshot.

**Depends on:** `@c4a/extract`, `web-tree-sitter`

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

The Context project may override auto-detection with source-relative
`extractTs.entries`, or use `mode: "scan"` to make every `include`-matched file
an extraction root. These settings live in the Context workspace; consumers do
not need to modify the analyzed package solely to declare extraction entries.

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
- TSX component-like variables
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

All emitted relations are code-grounded AST relations with confidence `1`.

### Export Tracing

`exportTracer.ts` follows:

- local exported declarations
- `export default <identifier>` when the identifier is locally declared
- `export * from "./module"`
- `export { A } from "./module"`
- aliased export specifiers
- circular re-export chains through an in-flight guard

Only declarations reachable through entries are marked `exported`; other declarations in traced files remain `internal`.

## Contract with Code Projection

The plugin returns `ExtractionResult` v2. The `@c4a/extract` runner turns that into raw snapshot rows:

- `packages.jsonl` receives package name/kind/language/version and package description when present.
- `symbols.jsonl` receives flattened symbol rows with `symbol_id`, `package_name`, and `module_path`.
- `edges.jsonl` receives relation rows with package/module/version/hash metadata.
- `digests.jsonl` receives versioned module digest rows.

The Context CLI consumes those rows during `context run extract:<source>:codegraph`
to build review candidates for package/category/symbol knowledge Nodes. The
important projection inputs are:

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

Workspace usage normally goes through a declared project phase:

```ts
import { defineProject, extractTs, reviewValidity, source } from "@c4a/context";

const componentLib = source("component-lib");

export default defineProject({
  sources: [componentLib],
  phases: [
    extractTs({ source: componentLib, collection: "codegraph" }),
    reviewValidity({ collection: "codegraph" }),
  ],
  packages: [],
});
```

The source boundary is registered first, then the phase is previewed or run:

```bash
context source add repo component-lib --local ../packages/component-lib
context run extract:component-lib:codegraph --dry-run
context run extract:component-lib:codegraph
```

Agents should not hand-build runner input or raw snapshots for normal Context
workspace operation.
