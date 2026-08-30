# Go Structure Extraction for Context

[简体中文](./README.zh-CN.md)

`@c4a/extract-go` provides deterministic Go structure facts for Context
knowledge projects. It extracts declarations, signatures, documentation,
imports, calls, and common HTTP route registrations without assigning
product-specific meaning.

This is an optional structural package. The Context runtime does not bundle it
or add a Go lifecycle phase automatically. A knowledge project opts in through
its own `extractCustom()` adapter, maps the returned facts to project-owned
candidates, and keeps review, evidence, freshness, close, and build under the
normal Context workflow.

## Place in the knowledge workflow

```text
confirmed Go repository boundary
             ↓
Go structural index
             ↓
project-owned extractCustom() mapping
             ↓
Context candidates → review → approved knowledge
```

## Public APIs

```ts
import {
  GoPlugin,
  goExtractionToEvidenceAdapterResult,
  indexGoRepository,
  indexGoSource,
} from "@c4a/extract-go";
```

- `GoPlugin` implements the standard `@c4a/extract` plugin protocol.
- `GoPlugin` reports `ast-catalog` capabilities and an explicit disposition for
  every parsed Go file.
- `goExtractionToEvidenceAdapterResult()` publishes the common
  `context.indexer.evidence-adapter-result/v1` wire result.
- `indexGoSource()` parses one source unit when an adapter needs detailed facts
  before producing candidates.
- `indexGoRepository()` indexes a repository tree with deterministic controls
  for include roots, tests, generated files, and excluded directories.

The output remains code-grounded. Package naming, business categories,
knowledge paths, candidate summaries, and approval decisions belong to the
knowledge project and its Agent workflow.

## When to use it

Use this package when a Context workspace needs Go symbols or relationships and
the project can define how those structures should become knowledge. Do not add
a generic Go phase solely to avoid writing the project mapping: a language
parser cannot know the audience, product boundaries, or useful knowledge shape.

## Development

```bash
bun run --filter @c4a/extract-go build
bun run --filter @c4a/extract-go typecheck
bun run --filter @c4a/extract-go test
bun run --filter @c4a/extract-go lint
```
