---
id: context.code-indexer.composer.event-flow
kind: procedure
media-type: text/markdown
---

# Event flow composer

Run only from an effective `event-flow` workset. The supplied primary view is
the complete authority boundary for this invocation.

Require an evidenced `event-binding` fact and primary `content` Artifact.
Propose derived `content` only when a stable event identity connects producer,
transport or dispatch, consumer, state effect, retry/idempotency behavior, and
failure handling. Timers and scheduled triggers qualify only when their
registration and downstream behavior are explicit.

Keep the current target Node, use `standard`, and cite view evidence. Do not
invent a producer from a consumer name or infer delivery guarantees from a
library default. Missing requirements, an unpaired boundary, or no additional
reader value must return the normal result envelope with `fragments: []`.
