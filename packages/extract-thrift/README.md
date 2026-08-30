# Thrift IDL Catalog for Context

[简体中文](./README.zh-CN.md)

`@c4a/extract-thrift` parses caller-registered Apache Thrift IDL files into deterministic service, method, type, include, namespace, annotation, generated-boundary, locator, and disposition evidence.

```ts
import { thriftSourcesToEvidenceAdapterResult } from "@c4a/extract-thrift";

const evidence = thriftSourcesToEvidenceAdapterResult(files, invocation);
```

The parser never reads an include outside the provided source map. Missing, absolute, or escaping includes make the importing file `unsupported`, and unsupported files publish no partial facts. The generated boundary identifies Thrift IDL as the authoritative contract and generated language bindings as derived output; it does not infer private ownership or code-generation platform state.

## Development

```bash
bun run --filter @c4a/extract-thrift typecheck
bun run --filter @c4a/extract-thrift lint
bun run --filter @c4a/extract-thrift test
bun run --filter @c4a/extract-thrift build
```
