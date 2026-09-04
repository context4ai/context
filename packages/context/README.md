# Context SDK

[简体中文](./README.zh-CN.md)

`@c4a/context` is the declarative SDK used by a Context knowledge workspace.
Most users work through the Context Agent and CLI; project authors use this
package to declare source capture and package output.

Knowledge authoring has one path: `src/indexers.yaml` selects Indexer Providers
and owns requirements, profiles, scopes, and customization. Code and Markdown
knowledge are not produced by project phases in `src/index.ts`.

## Project boundary

```text
sources/*/index.yaml       registered source boundaries
src/index.ts               capture and package declarations
src/indexers.yaml          knowledge-authoring authority
knowledge/                 approved, human-readable knowledge
dist/                      reader-facing package output
.tmp/context-runtime/      recoverable runtime state (not committed)
```

`src/index.ts` may declare:

- `source()` / `allSources()` references;
- `captureFile()` and `captureLark()` snapshot phases;
- `customPhase()` for project orchestration that does not publish knowledge;
- `kbPackage()` and `llmsPackage()` output definitions.

Example:

```ts
import {
  captureFile,
  defineProject,
  kbPackage,
  source,
} from "@c4a/context";

const docs = source("product-docs", { type: "file" });

export default defineProject({
  sources: [docs],
  phases: [captureFile({ source: docs })],
  packages: [
    kbPackage({
      name: "product-kb",
      template: "src/package-templates/kb",
      select: { collections: ["product", "architecture"] },
    }),
  ],
});
```

The Context lifecycle discovers or updates `src/indexers.yaml`, runs the
selected Provider, presents readable Candidate pages for Review, writes only
approved knowledge, and then builds declared packages.

## Public surface

| API | Purpose |
|---|---|
| `defineProject()` | Declares the project boundary. |
| `source()` / `allSources()` | References registered repo, file, or Lark sources. |
| `captureFile()` / `captureLark()` | Creates deterministic document snapshots. |
| `mdxJsonDocs()` | Configures the MDX/JSON documentation capture processor. |
| `customPhase()` | Runs non-knowledge project orchestration. |
| `kbPackage()` | Builds an Agent-readable knowledge package. |
| `llmsPackage()` | Builds a text bundle for model or retrieval input. |

The package also exports the Indexer schemas and validators used by Provider
authors and the Context runtime. Those APIs describe the same
`src/indexers.yaml` lifecycle; they are not a second user workflow.

Parser packages such as `@c4a/extract-ts`, `@c4a/extract-go`, and
`@c4a/extract-rush` are implementation dependencies of Indexer Providers. A
workspace does not wrap them in project phases.

## Knowledge and package output

Approved pages live under `knowledge/<collection>/`. Paths and filenames are
reader-oriented, for example:

```text
knowledge/codeindex/tux-web/avatar.md
knowledge/architecture/tux-official-docs/react-lynx-input-fields.md
```

Workspace pages keep only metadata required to rebuild or update knowledge.
Package pages in `dist/` contain the smaller reader projection: useful title,
kind, summary/tags when present, and content. Internal evidence identities and
digests stay in runtime artifacts unless recovery requires them.

Package templates live under `src/package-templates/`; installed examples are
available from `node_modules/@c4a/context/templates/package-templates/`.

## State boundary

Do not directly edit lifecycle files under `.tmp/context-runtime/`. The CLI
owns Candidate state, Review application, recovery, close, verification, and
build. Source registries, `src/index.ts`, `src/indexers.yaml`, approved
`knowledge/`, and package templates are the durable project inputs.

## Documentation

- [Documentation index](./docs/README.md)
- [Getting Started](./docs/getting-started.md)
- [Agent Guide](./docs/guides/agent-guide.md)
- [Project API](./docs/reference/project-api.md)
- [Indexer Provider Protocol](./docs/reference/indexer-provider-protocol.md)
- [Package Outputs](./docs/guides/package-outputs.md)
- [Package Templates](./docs/reference/package-templates.md)

