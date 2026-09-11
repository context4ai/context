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
reports at review decisions, and waits for user responses there. Offer fully
managed mode for the current conversation when appropriate: the Agent performs
delegatable reviews and reports results without requiring per-batch approval.
Do not promise a fixed time saving; it depends on scope and response time.

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
- Reuse explicit decisions that still apply to this task. Do not infer a new
  decision from a filename, URL, repository layout or example, and do not turn
  another conversation's managed authority into current authorization.
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
configuration and must not be persisted or reused in another conversation.
Managed mode by itself does not authorize expanding sources or performing remote
writes, and never bypasses validation. An explicit instruction to collect named
documents already establishes that read scope; do not ask for the same permission
again. Resolve essential missing goals or source boundaries before production.

`grill-me` is targeted clarification, not a fixed questionnaire. Research what the
available material can answer, then ask about consequential unknowns. A required
schema field is not automatically a question for the user. For the first production
task in a new workspace, the work-start report must resolve and display the agreed
purpose, source families, language, settings, outputs and first delivery before
source registration. Present it and wait for feedback even in managed mode. A
report must not silently substitute guessed decisions for unanswered questions.
