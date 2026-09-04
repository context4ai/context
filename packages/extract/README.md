# @c4a/extract

[简体中文](./README.zh-CN.md)

`@c4a/extract` turns repository structure into deterministic evidence that a
Context knowledge workflow can review and explain. It owns the language-plugin
protocol, repository runner, raw code snapshot contract, digest generation, and
shared Tree-sitter parsing utilities.

It does not decide what code means to a product or audience and does not write
approved knowledge. Language plugins emit structural facts; the Context runtime
binds them to source identity, stages review candidates, and applies approved
knowledge through the normal lifecycle.

## Package Role

`@c4a/extract` is the protocol and runner layer used by Code Indexer Providers.

- Language plugins implement `ExtractionPlugin` and return `ExtractionResult` v2.
- The runner loads one or more plugins, scans repository modules, emits progress/module-error/summary events, and can build an optional low-level code snapshot payload.
- The selected Provider invokes the runner through the controlled Indexer workset and returns typed facts and artifacts.
- Context stages Candidate state under `.tmp/context-runtime/`; approved Markdown is written only by Review apply and close.

**Depends on:** `@c4a/core`, `web-tree-sitter`, `zod`

```text
confirmed repository boundary
          ↓
language plugins + repository runner
          ↓
versioned raw code snapshot
          ↓
Indexer facts → reader-oriented Candidates → approved knowledge
```

Knowledge-workspace users normally reach this package through the installed
Agent entry and selected Code Indexer Provider. The runner protocol below is
for parser authors, Provider authors, and Context maintainers.

## Protocol Layers

### 1. Language Plugin Protocol

Language packages implement `ExtractionPlugin` from `protocol.ts`.

```ts
interface ExtractionPlugin {
  id: string;
  languages: string[];
  packageManagers: string[];
  manifestTypes?: ManifestInfo["type"][];
  canHandle(source: SourceInfo): boolean;
  detectEntries(manifest: ManifestInfo, fs: FileSystem): Promise<EntryDetectionResult>;
  extractSymbols(entries: EntryFile[], fs: FileSystem): Promise<ExtractionResult>;
  detectPatterns?(fs: FileSystem): Promise<PatternDetectionResult>;
}
```

Important constraints:

- Plugins read through `FileSystem`; they should not access `node:fs` directly.
- `manifestTypes` declares which manifest is passed to `detectEntries()`. It is
  optional for a single-manifest module and required when a plugin accepts a
  module containing multiple manifest types.
- `detectEntries()` must return package identity, package kind, language, optional version, and entry files.
- `extractSymbols()` must return `ExtractionResult` v2 with stable symbols and relations.
- `detectEntries()` is called before `extractSymbols()`; plugins may keep per-detection package context between those calls.

For Indexer execution, `extractionResultToEvidenceAdapterResult()` converts a
coverage-complete `ExtractionResult` into
`context.indexer.evidence-adapter-result/v1`. The caller supplies the resolved
package/export/version/digest, authorized source/module scope, input digest,
precedence, and owner role. Conversion fails when per-file coverage is absent;
lightweight or enricher output cannot contribute file, LOC, symbol, or protocol
denominators.

### 2. ExtractionResult v2

Every plugin returns:

```ts
{
  version: "2",
  meta: { extractedAt, pluginId, commitHash, language },
  package: { name, kind, language, version? },
  files: [{ path, language, lines }],
  symbols: SymbolInfo[],
  relations: RelationInfo[],
  coverage: {
    tier,
    capabilities,
    files: [{ path, disposition, diagnosticCodes }],
    diagnostics
  },
  stats: { files, lines, exportedSymbols, internalSymbols, relations }
}
```

`SymbolInfo` supports:

- identity: `name`, `kind`, `visibility`, `file`, `line`, `endLine`
- structure: nested `members`
- type surfaces: `params`, `returnType`, `typeAnnotation`, `extends`, `implements`, `propsType`, `unionValues`
- source documentation: `doc`

`RelationInfo` supports code edges such as `imports`, `imports_type`, `calls`, `extends`, `implements`, `param_type`, `return_type`, `of_type`, `depends_on`, and `contains`.

### 3. Repository Runner Protocol

The package exposes `c4a-extract-code`, a low-level NDJSON runner. Code Indexer
Providers may invoke it as an implementation detail; agents should not
hand-build runner input for normal workspace operation.

Input is JSON on stdin:

```json
{
  "repoPath": "/path/to/repo",
  "modules": ["packages/example"],
  "commitHash": "abc123",
  "pathFilter": {},
  "plugins": [{ "package": "@c4a/extract-ts", "exportName": "TypeScriptPlugin" }],
  "snapshot": {
    "sourceId": "aspect:code:example",
    "sourceSlug": "example",
    "snapshotId": "code-abc123-deadbeef",
    "codeSnapshotContractVersion": "<contract-version>",
    "scriptHash": "sha256:...",
    "toolchain": {
      "manager_package": "@c4a/context-cli",
      "manager_version": "<manager-version>",
      "runner_package": "@c4a/extract",
      "runner_package_version": "<runner-version>",
      "runner_bin": "c4a-extract-code",
      "plugin_package": "@c4a/extract-ts",
      "plugin_package_version": "<plugin-version>",
      "plugin_export": "TypeScriptPlugin"
    }
  }
}
```

Output is one JSON object per line:

- `{ "type": "progress", "phase": "scanning|parsing|uploading", ... }`
- `{ "type": "module_error", "module_name": "...", "module_path": "...", "error": "..." }`
- `{ "type": "summary", "extraction": ..., "snapshot": ... }`
- `{ "type": "error", "code": "runner-failed", "message": "..." }`

The runner does not write `.context` directly. It returns snapshot files in the summary; `@c4a/context-cli` validates and writes them atomically.

### 4. Raw Code Snapshot Contract

When `snapshot` input is provided, the runner builds these files:

| File | Purpose |
|---|---|
| `source.yaml` | Source manifest for the code aspect source |
| `manifest.json` | Snapshot manifest: contract version, toolchain, counts, hash, dirty state |
| `_meta.yaml` | Backward-compatible snapshot metadata and input summary |
| `digests.jsonl` | Per-module digest rows with version, hash, dirty state, and digest payload |
| `source-files.jsonl` | Source-to-module/digest mapping |
| `packages.jsonl` | Package rows: name, kind, language, module path, optional version/description |
| `symbols.jsonl` | Flat symbol rows; nested members are flattened and retain package/module fields |
| `edges.jsonl` | Code relation rows with package/module/version/hash fields |

`@c4a/context-cli` validates this contract before projection. Required fields include package/module identity, version labels on digest/source-file/edge rows, symbol identity fields, and matching edge/digest versions.

During projection, code-owned Sections receive code `source_ref` values derived from these rows:

- package rows: `src-N#package:<package>@<hash>`
- symbol rows: `src-N#symbol:<file>:<symbol>:<kind>@<hash>`

These refs are verified against the raw code snapshot JSONL indexes. They are
separate from prose evidence refs, because code snapshots use
`evidence.mode: none` and do not create raw block manifests. Prose/raw evidence
uses `src-N#block:<locator> L<start>-<end>@<block-hash>` so it can keep line
ranges for review, diffing, and re-anchoring.

## Writing a New Language Plugin

Create a package such as `@c4a/extract-python` and export an `ExtractionPlugin`.

Minimum requirements:

1. Detect the language manifest in `canHandle()` and `detectEntries()`.
2. Return stable package identity: package name, kind, language, and version when available.
3. Return `subPackages` when one manifest represents a nested package layout.
4. Resolve public entry files so exported symbols can be distinguished from internal symbols.
5. Emit `SymbolInfo[]` with stable `name`, `kind`, `visibility`, `file`, `line`, and `endLine`.
6. Emit `RelationInfo[]` for imports and important type/inheritance/use edges.
7. Keep paths module-relative inside the plugin; the repository runner prefixes them to repo-relative paths.
8. Register the plugin in the Code Indexer Provider's runner configuration.
   User-facing workspaces select the Provider through `src/indexers.yaml`.

Example skeleton:

```ts
import type {
  EntryDetectionResult,
  EntryFile,
  ExtractionPlugin,
  ExtractionResult,
  FileSystem,
  ManifestInfo,
  SourceInfo,
} from "@c4a/extract";

export class PythonPlugin implements ExtractionPlugin {
  readonly id = "c4a-extract-python";
  readonly languages = ["python"];
  readonly packageManagers = ["pip"];
  readonly manifestTypes: ManifestInfo["type"][] = ["pyproject.toml"];

  canHandle(source: SourceInfo): boolean {
    return source.manifests.some((manifest) => manifest.type === "pyproject.toml");
  }

  async detectEntries(manifest: ManifestInfo, fs: FileSystem): Promise<EntryDetectionResult> {
    // Parse pyproject.toml/setup metadata and return package + entry files.
  }

  async extractSymbols(entries: EntryFile[], fs: FileSystem): Promise<ExtractionResult> {
    // Parse entry graph, classify exported/internal symbols, emit relations.
  }
}
```

## Relationship to the Code Indexer

`@c4a/extract` is upstream of the Code Indexer Provider; it does not render
approved knowledge itself.

- `context source add repo <name> --local <repo-or-subdir>` registers the code
  source boundary.
- `src/indexers.yaml` binds the source scope and reader requirements to a Code
  Indexer Provider.
- The current Route prepares a controlled workset and the Provider returns the
  current Indexer result.
- Context writes draft Candidates and recoverable runtime artifacts under
  `.tmp/context-runtime/`; that directory is not committed state.
- `context review html` and `context review apply` own human approval and
  approved Markdown materialization.
- `context close`, `context verify`, and `context build` own final package
  readiness.

That means language plugins affect published knowledge only through the current
Indexer flow: better symbols/relations produce better draft Candidates, stable
`repo:<source>#symbol:...` source refs, review evidence, approved Markdown, and
package output.

Approved code knowledge may localize canonical refs as
`src-N#symbol:<file>:<symbol>:<kind>@<digest>`. The file segment is part of the
deterministic evidence identity used by verification; agents copy the complete
ref as an opaque token.
