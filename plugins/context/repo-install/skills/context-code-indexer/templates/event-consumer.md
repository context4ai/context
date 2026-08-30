---
id: context.code-indexer.template.event-consumer
kind: procedure
media-type: text/markdown
---

# Event consumer template

Use for `event-consumer`. This template supplements the owning runtime, service,
application, or adapter Artifact; an event signal does not by itself justify a
separate end-to-end Artifact.

## Evidence pass

Locate:

- topic, stream, queue, hook, notification, or event identity;
- authoritative schema and versioning source;
- producer call and publication condition;
- subscription/consumer registration and handler dispatch;
- delivery, ordering, partitioning, retry, dead-letter, checkpoint, and
  idempotency configuration;
- emitted side effects, observability, replay, and recovery entrypoints.

Do not derive delivery guarantees from framework defaults.

## Questions the knowledge must answer

1. What event is emitted or consumed, under what condition, and by whom?
2. Where is publication or subscription registered?
3. What delivery and recovery behavior is actually configured?
4. What state or side effects change, and how can failed work be identified?

## Chapter blueprint

```markdown
# <Event flow or family>
## Event identity and authoritative schema
## Producer and publication condition
## Delivery and routing semantics
## Consumer registration and processing
## Idempotency, retry, checkpoint, and failure destination
## Side effects and observability
## Source-backed producer-to-consumer relationship
```

When only one endpoint is registered, keep an event record inside that
module's runtime or service map and omit the unavailable endpoint. Create a
separate event-flow page only when both sides and their shared event identity
are evidenced, or when one side alone has enough delivery and recovery
semantics to be a stable operator-facing topic.

## Granularity and stop conditions

Group events with the same schema authority, delivery policy, ownership, and
handler family. Do not create pages per event field, generated payload type,
handler helper, or retry branch.

Every retained record must name the event identity, registration or call site,
and source locator. Revise or stop when delivery semantics would be guessed,
the shared identity is missing, or the output would contain empty producer or
consumer sections.
