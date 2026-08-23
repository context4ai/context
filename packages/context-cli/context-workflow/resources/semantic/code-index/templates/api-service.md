---
id: semantic.code-index.template.api-service
kind: procedure
media-type: text/markdown
---

# API service and gateway template

Use after classifying an inbound HTTP, RPC, GraphQL, message-request, or similar
surface as `api-service`. A module that only calls a remote API is a protocol
consumer, not automatically an API service. Gateways that translate to another
protocol normally also select `adapter`.

Recommended `outputProfile`: `protocol-index`. If the reader goal is primarily
the transformation between inbound and outbound boundaries, use
`adapter-contract` instead and retain one canonical operation registry.

## Evidence pass

Locate and connect:

- process/server entry and service startup;
- route, method, resolver, or service registration;
- middleware, authentication, authorization, validation, and request context;
- handler dispatch and the first stable domain/downstream boundary;
- authoritative IDL, OpenAPI, schema, service definition, or registration;
- response/error mapping, retry, timeout, and compatibility behavior;
- configuration, local run, test, deployment, and release entrypoints;
- generated models or clients and their actual source of truth.

Prefer explicit registrations over handler filenames. Sample enough operations
from each registration family to verify that the proposed aggregation is real.

## Questions the knowledge must answer

1. What protocol does the module provide, and where is it registered?
2. Which operations are stable and who handles each one?
3. What authentication, validation, middleware, or request context applies?
4. Where does each operation hand off to domain logic or a downstream system?
5. How are successful responses and failures translated?
6. Which schema is authoritative, and which files are generated projections?
7. How is the service run, configured, observed, and released?

## Suggested knowledge units

- **Service boundary**: responsibility, startup, supported protocols,
  middleware order, downstream systems, and ownership.
- **Operation registry**: use the canonical operation record from
  `protocol-boundary.md`, adding handler and middleware detail from this
  template rather than creating a second registry.
- **Dispatch and dependency map**: route/service registration to handler to
  domain/RPC/repository boundary, grouped by coherent operation family.
- **Error and compatibility contract**: only when status/error mapping,
  versioning, fallback, or compatibility is stable and source-backed.
- **Runtime and delivery guide**: configuration, startup, diagnostics,
  deployment, and release entrypoints owned by this service.

Do not create a page per generated request/response model, constant, converter,
pack/unpack helper, or handler-local function.

## Chapter blueprints

A service-boundary page may use:

```markdown
# <Service> boundary
## Responsibility and consumers
## Startup and protocol registration
## Middleware and request lifecycle
## Operation families
## Domain and downstream dependencies
## Error, timeout, and compatibility behavior
## Configuration, observability, and release
## Exclusions and authoritative schemas
```

A focused execution-path page may use:

```markdown
# <Operation> execution path
## Inbound contract
## Middleware and validation
## Handler orchestration
## Domain/downstream handoff
## Response and error mapping
## Source-backed edges
```

## Granularity and relationships

Aggregate operations that share registration, middleware, handler family, and
downstream ownership. Split when operation families have different contracts,
owners, or execution paths—not merely because they are separate methods.

Record a route-to-handler or handler-to-downstream edge only when the route
table, registration, call site, or parser evidence is unambiguous. Generated
types can locate fields but do not prove runtime behavior.

## Template composition examples

- A gateway that receives HTTP and calls RPC reads `adapter.md` and
  `protocol-boundary.md` in addition to this template.
- An RPC service containing stable domain orchestration also reads
  `domain-service.md`.
- An event-triggered endpoint may require `event-flow.md`; background consumers
  use `background-runtime.md`.

## Revise or stop when

- no registration or authoritative operation identity is available;
- the plan lists handlers without connecting them to provided operations;
- the only contract source is generated code with an unknown upstream schema;
- security or error behavior would be guessed from names;
- scan mode would expand models and helpers into hundreds of pages.

Mark unavailable protocol semantics as `material-required` before preview.
