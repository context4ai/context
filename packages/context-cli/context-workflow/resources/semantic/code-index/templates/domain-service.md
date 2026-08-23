---
id: semantic.code-index.template.domain-service
kind: procedure
media-type: text/markdown
---

# Domain service template

Use for `service` modules whose stable value is a domain/use-case boundary or a
reusable service contract and its first-level orchestration. Do not classify a
directory as a service merely because it contains classes or functions named
`Service`.

Recommended `outputProfile`: `service-boundary`.

## Evidence pass

Locate:

- service construction, registration, dependency injection, or public entry;
- supported operations and their callers or protocol handlers;
- use-case/domain orchestration and the point where ownership changes;
- repositories, transactions, caches, downstream clients, and event ports;
- invariants, idempotency, consistency, permission, or failure boundaries;
- configuration and runtime wiring that materially change the service;
- generated clients/models and internal helpers that should remain evidence.

Follow representative public operations through one orchestration layer. Stop
at the first stable domain, persistence, or downstream protocol boundary unless
the confirmed knowledge goal explicitly needs deeper implementation behavior.

## Questions the knowledge must answer

1. What responsibility and invariants does this service own?
2. Which operations form its supported boundary, and who calls them?
3. How do operations coordinate domain logic and dependencies?
4. Where are transaction, consistency, idempotency, or state boundaries?
5. What failures can cross the boundary, and how are they represented?
6. Which dependencies are stable contracts versus internal implementation?

## Suggested knowledge units

- **Service boundary**: responsibility, public operations, ownership,
  invariants, callers, and stable dependencies.
- **Operation/use-case map**: operation to orchestration to first stable
  downstream/persistence/event boundary.
- **State and consistency contract**: only when transaction, idempotency,
  caching, or durable state is important and evidenced.
- **Dependency map**: concrete ports/clients/repositories and why each boundary
  matters; avoid a raw import inventory.
- **Runtime/configuration guide**: only module-owned configuration, startup,
  diagnostics, or release behavior.

## Chapter blueprints

```markdown
# <Domain service> boundary
## Responsibility and non-responsibilities
## Supported operations and callers
## Domain rules and invariants
## Dependency and port boundaries
## State, transaction, and idempotency behavior
## Failure and recovery behavior
## Configuration and runtime wiring
## Evidence and excluded implementation detail
```

For a use-case family:

```markdown
## <Use-case family>
- Trigger or caller:
- Supported operation:
- Preconditions and invariants:
- Orchestration steps:
- Persistence/downstream/event boundary:
- Result and failure semantics:
- Source evidence:
```

## Granularity and relationships

Group operations that share responsibility, invariants, and dependency paths.
Split only when ownership or consistency semantics differ. Do not publish every
exported method: language visibility is not proof of a supported service API.
Every retained page must name supported operations, callers, ports, or state
identities and include source locators; a folder/class inventory is not a
service boundary.

Relationships should connect supported operations to real callers, ports,
repositories, or downstream operations. Do not infer a domain flow from
similar names or shared models.

## Template composition examples

- An RPC implementation reads `api-service.md` for its inbound registration and
  this template for domain orchestration.
- A service backed by durable storage selects the `persistence` facet and reads
  `persistence-boundary.md`.
- A service activated only by events also reads `background-runtime.md` and the
  `event-flow.md` template.

## Revise or stop when

- no stable caller or public service boundary can be found;
- the proposed content is a class-by-class implementation listing;
- invariants or data semantics depend on unavailable documentation;
- generated models are being treated as the domain source of truth;
- an end-to-end chain crosses undeclared source modules.
