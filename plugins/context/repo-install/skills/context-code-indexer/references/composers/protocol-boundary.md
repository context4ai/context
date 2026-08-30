---
id: context.code-indexer.composer.protocol-boundary
kind: procedure
media-type: text/markdown
---

# Protocol boundary composer

Run only for an effective `protocol-boundary` composer workset and consume its
exact `PrimaryResultView`. Never discover new scope or claim final Result
authority.

Require an evidenced `protocol-operation` fact and a primary `contract`
Artifact. A derived `contract` proposal may connect a stable operation identity
to transport, request/response or message shapes, provider and consumer,
errors, compatibility, and authoritative schema evidence. Keep generated
clients and bindings pointed at their source contract.

Use the existing target Node and `standard` policy. Do not infer operations
from names or import adjacency. If the required fact/Artifact is missing, the
provider/consumer pairing is ambiguous, or the primary contract already
answers the reader question, return a valid result with `fragments: []`.
