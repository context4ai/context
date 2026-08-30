# @c4a/extract-contract

Static OpenAPI and GraphQL contract catalog adapter for Context.

The package parses only the caller-provided source map. OpenAPI external references must resolve to registered relative files. GraphQL files in one invocation form one schema scope so type extensions resolve to an exact base definition. Missing, escaping, ambiguous, cyclic, or unsupported dependencies make the affected file unsupported; unsupported files publish no partial facts.

It emits the common `context.indexer.evidence-adapter-result/v1` ABI with endpoint, operation, type, reference, generated-source boundary, locator, disposition, and diagnostic evidence. It does not fetch remote schemas, execute GraphQL operations, generate clients, or publish source prose.

```ts
import { parseContractSources } from "@c4a/extract-contract";

const catalogs = parseContractSources({
  "api/openapi.yaml": "openapi: '3.1.0'\ninfo: { title: API, version: '1' }\npaths: {}",
  "graphql/schema.graphql": "type Query { ready: Boolean! }",
});
```
