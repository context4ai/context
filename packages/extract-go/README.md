# @c4a/extract-go

Go extraction plugin for Context's `ExtractionResult v2` protocol. It extracts
declarations, signatures, documentation, imports, calls, and common HTTP route
registrations without applying product-specific classifications.

```ts
import { GoPlugin, indexGoRepository, indexGoSource } from "@c4a/extract-go";
```

Use `GoPlugin` with `@c4a/extract`, or use `indexGoSource()` when a project-owned
extractor needs detailed Go facts before building its own candidates.
`indexGoRepository()` provides the same structural facts for a repository tree,
with deterministic controls for include roots, tests, generated files, and
excluded directories.

This package is optional. Context CLI does not bundle it or add a Go lifecycle
phase. A knowledge project opts in from its own `extractCustom()` callback.
