---
id: procedure.document-capture
kind: procedure
mediaType: text/markdown
---

# Document capture

Capture creates a reproducible local snapshot of a registered document source.
It does not classify, summarize, approve, or build knowledge.

Before capture:

1. every registered document module must have a matching capture declaration;
2. the user must have allowed the external read in the current conversation;
3. execute only the current route command.

An explicit request to capture, ingest, fetch, or read named file/remote
documents grants source-read permission for those named modules. A mention,
possible-source discussion, or register-only request does not. An explicit
refusal always wins.

When that permission is already present in the conversation, execute the
Gate's returned authority-carrying command. In managed mode it runs the
deterministic capture batch until the next real blocker; in ordinary mode it
reevaluates status with `context.source-read`. The authority remains in the
current command chain and is never persisted in the project. Never bypass the
Route by running a bare capture phase.

Document capture is an external action. Execute a returned command with
`execution.target: agent-host` through the Agent host so its network and
credential-store access remain available; do not nest it inside a restricted
child sandbox. If the CLI reports an external-environment requirement, retry
the same returned command through the host. Never downgrade credential
protection as a recovery step.

Capture targets are a batch. Process one current target, evaluate status again,
and continue until the graph reports the batch complete. Never treat one
successful module as completion of the whole batch.

The CLI owns normalization, snapshot identity, hashes, manifests, and
idempotency. For Lark sources it also owns embedded-resource download,
structured export, completeness reporting, and link projection. Required
resource failures block the next phase; reference-only resources remain
explicit in the report. Never hand-write or repair captured snapshots or their
asset links. If a selected local
boundary is a documentation site rather than plain Markdown, use the
Context-provided processor/configuration diagnostic; do not invent rendered
text or scan outside the confirmed boundary.

For Lark reads, Context prefers the authenticated user identity. If that
identity is unavailable because its credential is missing, expired, or cannot
be refreshed, Context may retry the same registered source with the bot
identity. It does not switch identity after a permission or missing-scope
response. Once selected, the same identity is used for the document body and
all embedded resources. If `docs +fetch` lacks the required `--doc-format`
capability, follow the returned `lark-cli update` recovery and rerun the same
Route command; do not replace the capture with a hand-written export.
