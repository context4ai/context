---
id: context.code-indexer.template.gateway-facade
kind: procedure
media-type: text/markdown
---

# Gateway and protocol facade template

Use for `gateway-facade` when the selected reader goal is the boundary exposed
or translated by one gateway. This template owns the canonical operation
record. Application, API, service, SDK, contract-source, and adapter templates
provide context but must not create a second registry for the same operations.

## Evidence pass

Locate:

- the authoritative IDL, OpenAPI document, schema, service definition, or
  explicit registration;
- provider operation identity and dispatch when the provider is in scope;
- consumer client construction and concrete operation call site when the
  consumer is in scope;
- request, response, message, identity, and context mapping boundaries;
- authentication, authorization, timeout, retry, compatibility, and error
  translation that are explicitly configured;
- generated bindings, their generator/version, and their upstream authority.

Do not infer protocol semantics from matching type names, generated model
fields, imports, or transport-library dependencies.

## Questions the knowledge must answer

1. Which concrete operation or coherent operation family is provided or used?
2. Where is it registered or called, and where is its contract authoritative?
3. What request, response, identity, credential, and context mapping occurs?
4. What timeout, retry, compatibility, and failure behavior is source-backed?
5. Which generated artifacts are locators rather than independent authority?

## Canonical operation record

Use this record wherever another selected template asks for an operation,
route-to-client, or adapter mapping registry. Add type-specific detail around
it rather than copying the operation into another table.

```markdown
## <Protocol operation or family>
- Provider identity and registration:
- Consumer call site:
- Authoritative contract:
- Request, identity, and context mapping:
- Response and error mapping:
- Timeout, retry, and compatibility:
- Source-backed relationship:
```

Provider-only records omit the consumer line. Consumer-only records omit
provider dispatch and remain inside the owning module page unless the opposite
endpoint is also a registered source and an evidenced cross-module flow is a
separate reader goal.

## Generated and authoritative contracts

For generated contract material, also select `derived-generated-source` and
record the upstream schema, generator, version/pin, generated output boundary,
and runtime consumer. Generated code may locate operations and fields but does
not become semantic authority by itself.

When the upstream authority is unavailable, a separate provenance Artifact may
still record the generated boundary, generator markers, current consumers, and
known authority gap. Keep the question that would explain field semantics or
compatibility unresolved as a material gap; do not block an independently
supported provenance record.

For a `contract-source` module, preserve exact operation identities, namespaces,
versions, compatibility declarations, imports, and generator targets. Do not
invent runtime dispatch or consumer behavior that the contract does not define.

## Granularity and relationships

Aggregate operations by contract, ownership, and execution family. Split when
authority, mapping, security, versioning, or failure semantics materially
differ. Do not create pages for every generated request/response type or field.

Every page must contain concrete operation or schema identities and source
locators. A page that only says a module “uses an API” is not sufficient.

Revise or stop when operation identity is unavailable, authority is ambiguous,
security/error behavior would be guessed, or a claimed provider-consumer join
has no source-backed registration and call evidence.
