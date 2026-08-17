# @c4a/core

`@c4a/core` is the shared foundation package for Context. It provides reusable types, schemas, error definitions, and utility helpers used across multiple packages.

## Installation

```bash
bun add @c4a/core
# or
npm install @c4a/core
```

## What It Includes

- **Domain types**: common TypeScript types for entities, relations, contents, and sources
- **Schema definitions**: Zod-based input/output validation models
- **Error system**: unified error codes and `C4AError`
- **Ref utilities**: helpers for parsing and building `ref:*` pointers
- **Shared constants and helpers**: reusable utilities for Context extraction
  and CLI packages

## Example

```ts
import { C4AError, ErrorCode, parseRef } from "@c4a/core";

const parsed = parseRef("ref:entity:ent_123");
if (!parsed) {
  throw new C4AError(ErrorCode.VALIDATION_FAILED, "Invalid ref");
}
```

## Common Use Cases

- Reuse a single contract across a monorepo to avoid type drift
- Validate external inputs with consistent schemas and error handling
- Parse and build cross-resource reference pointers

## License

MIT
