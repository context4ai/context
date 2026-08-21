# Agent Dialogue

Context human gates should be explained as product decisions, not exposed as
SDK or CLI implementation details.

## Current Authority

Run:

```bash
context status --format json
```

For a gate, `workflow.current.resources.required` includes the exact dialogue
resource for that decision together with its operating procedure and current
workspace view. Read those selected resources before asking the question. The
gate-specific source-boundary, read-permission, classification, extraction,
structure, Review, package, and evidence-maintenance guidance is intentionally
not duplicated in this SDK manual.

This keeps a new Agent from loading every possible conversation script before
it knows which decision is current.

The ordinary path also selects short mode guidance after workspace creation
and source capture. Explain that ordinary review is the default, provides HTML
reports at review decisions, and is currently estimated to take about 40%
longer overall depending on scope and response time. Offer fully managed mode
for the current conversation while explaining that it gives the user fewer
opportunities to adjust intermediate content.

## Stable Principles

- Use the user's conversation language for explanations and questions.
- Keep commands, paths, ids, payload fields, status values, and `source_ref`
  tokens exact.
- Explain what is being decided, what changes after confirmation, and which
  alternatives exist before showing implementation detail.
- Prefer the host's native choice UI for a small fixed option set. Otherwise
  use concise A/B/C choices with one impact sentence each.
- Use semantic labels such as “Agent knowledge-base package” rather than SDK
  factory names such as `kbPackage`.
- Do not infer a decision from a filename, URL, repository layout, example, or
  previous conversation.
- Keep transition reports short: what changed, the current state, and the next
  decision or action.

## Fully Managed Conversations

Only when the user explicitly requests fully managed operation in the current
conversation, use:

```bash
context status --managed --format json
```

The returned route decides which delegatable gates may proceed without another
question. A Gate may keep its ordinary inspection Action and dialogue resources
while replacing them with a direct revision-bound resolution path only for a
session-authority Route. Necessary evidence inspection remains selected for
semantic scope or classification work. This authority is not project
configuration and must not be persisted or reused in another conversation. It cannot choose source boundaries,
authorize unread external sources or external operations, or bypass validation
and verification.
