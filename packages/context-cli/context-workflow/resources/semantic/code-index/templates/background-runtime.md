---
id: semantic.code-index.template.background-runtime
kind: procedure
media-type: text/markdown
---

# Background runtime template

Use for `background-runtime`: queue or stream consumers, scheduled jobs,
pipelines, functions, controllers, watchers, and long-running agents activated
by a trigger instead of an interactive request.

Recommended `outputProfile`: `runtime-map`.

## Evidence pass

Locate:

- process/runtime bootstrap and worker/job registration;
- trigger identity: topic, queue, schedule, hook, file, controller event, or
  platform invocation;
- payload/schema locator and producer when available;
- handler dispatch, concurrency, partitioning, ordering, and state changes;
- downstream services, persistence, emitted events, and side effects;
- retry, timeout, checkpoint, idempotency, dead-letter, and recovery behavior;
- configuration, scaling, health, observability, deployment, and ownership;
- replay/test fixtures and generated payload types that are not authoritative.

Distinguish code defaults from runtime configuration. Do not describe delivery
guarantees unless registration, framework configuration, or maintained
documentation proves them.

## Questions the knowledge must answer

1. What activates the runtime and where is that trigger registered?
2. What input contract is consumed, and who produces it?
3. How does work move from dispatch through orchestration and side effects?
4. What are the concurrency, ordering, retry, and idempotency boundaries?
5. How does the runtime checkpoint, recover, or surface failed work?
6. How is it configured, operated, observed, scaled, and deployed?

## Suggested knowledge units

- **Runtime map**: bootstrap, trigger families, handler registry, dependencies,
  state boundaries, and operating model.
- **Trigger/workflow registry**: stable trigger identity, input contract,
  handler, downstream effects, retry/idempotency, and source locator.
- **Processing flow**: focused end-to-end path for a high-value workflow family.
- **Recovery and operations guide**: checkpointing, failed work, observability,
  configuration, local execution, deployment, and safe replay where evidenced.
- **Producer-consumer chain**: only when both registered modules and the event
  identity are source-backed.

## Chapter blueprints

```markdown
# <Background runtime> map
## Responsibility and activation model
## Bootstrap and trigger registration
## Workflow or handler families
## State and downstream side effects
## Concurrency, ordering, retry, and idempotency
## Failure recovery and observability
## Configuration, scaling, and deployment
## Contract sources and exclusions
```

For a trigger family:

```markdown
## <Trigger or workflow>
- Trigger identity and registration:
- Input contract and producer:
- Dispatch and handler:
- State changes and downstream effects:
- Retry/idempotency/checkpoint behavior:
- Failure destination and operator action:
- Source evidence:
```

## Granularity and relationships

Prefer one record per stable trigger or coherent workflow family. Do not create
one page per handler helper, event field, retry branch, or generated payload
type. Split a page when triggers have different contracts, ownership, delivery,
or recovery semantics.

Every retained page must name concrete trigger, handler, state, side-effect,
and recovery identities with source locators. A runtime page that only lists
directories or says a worker “processes events” is too thin.

Connect producers and consumers only through a concrete topic/trigger/schema
identity. A shared type name or import is insufficient.

## Template composition examples

- A consumer that invokes a domain boundary reads `domain-service.md`.
- A scheduler that calls external APIs selects `protocol-consumer` and reads
  `protocol-boundary.md`.
- A controller exposing administrative commands may combine this template with
  `cli-tool.md` or `api-service.md`, but should still produce one runtime map.

## Revise or stop when

- no trigger registry or executable worker entry can be found;
- delivery, ordering, retry, or idempotency would be guessed;
- the producer or authoritative payload contract is required but unavailable;
- the plan expands generated event structures or helpers one symbol per page;
- runtime configuration cannot be distinguished from test setup.
