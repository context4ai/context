# Context Core Contracts

[简体中文](./README.zh-CN.md)

`@c4a/core` is the shared contract package used by Context's project SDK,
extraction framework, and local workflow runtime. It keeps identities, schemas,
errors, and reference helpers consistent across package boundaries.

This package is infrastructure for Context maintainers and extension authors.
Knowledge-workspace users normally work through the Context Agent entry and do
not install it directly.

## Place in the knowledge workflow

```text
project SDK ─┐
extractors ──┼─→ shared types / schemas / errors / references
runtime ─────┘
```

Core contracts prevent the same source, entity, relation, or diagnostic from
acquiring different shapes as it moves from capture to extraction, review,
verification, and package build.

## What it provides

- domain types for entities, relations, content, sources, and extraction data;
- Zod schemas for validating shared inputs and outputs;
- stable error codes and the exported `C4AError` API;
- helpers for parsing and constructing `ref:*` pointers;
- constants and utilities shared by extraction and workflow packages.

The `C4AError` symbol and `@c4a/core` package name are published API
identifiers. They are not a separate user-facing product model and should not
be copied into generated knowledge content.

## Example

```ts
import { C4AError, ErrorCode, parseRef } from "@c4a/core";

const parsed = parseRef("ref:entity:ent_123");
if (!parsed) {
  throw new C4AError(ErrorCode.VALIDATION_FAILED, "Invalid ref");
}
```

## Use this package when

- adding a shared protocol consumed by more than one Context package;
- validating external or serialized data at a package boundary;
- working with cross-resource identities and references;
- implementing an extractor that must return Context-compatible structures.

Do not place workflow routing, source-specific business meaning, Agent prompts,
or filesystem lifecycle behavior here. Those belong to the workflow Provider,
project SDK, extraction plugins, or runtime respectively.

## Development

```bash
bun run --filter @c4a/core build
bun run --filter @c4a/core typecheck
bun run --filter @c4a/core test
bun run --filter @c4a/core lint
```

Runtime code remains Node.js compatible.

## License

MIT.
