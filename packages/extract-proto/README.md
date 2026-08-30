# Protocol Buffers Catalog for Context

[简体中文](./README.zh-CN.md)

`@c4a/extract-proto` parses caller-registered Protocol Buffers sources into deterministic package, import, option, message, enum, service, RPC, generated-boundary, locator, and disposition evidence.

```ts
import { protoSourcesToEvidenceAdapterResult } from "@c4a/extract-proto";

const evidence = protoSourcesToEvidenceAdapterResult(files, invocation);
```

Import resolution is limited to the provided source map and explicit import roots. Missing, absolute, or escaping imports make the importing file `unsupported`, and unsupported files publish no partial facts. The parser supports proto2/proto3 declarations and Editions syntax used by the public language grammar; it does not infer private code-generation platform state.

## Development

```bash
bun run --filter @c4a/extract-proto typecheck
bun run --filter @c4a/extract-proto lint
bun run --filter @c4a/extract-proto test
bun run --filter @c4a/extract-proto build
```
