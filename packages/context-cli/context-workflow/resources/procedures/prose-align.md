---
id: procedure.prose-align
kind: procedure
mediaType: text/markdown
---

# Prose structure alignment

Alignment proposes source-bound knowledge structure. It does not write approved
knowledge.

Follow the current route's evidence view and input schema. Prefer source heading
and block boundaries when they preserve coherent reading units; fixed line
windows are only a fallback for unstructured text. A page may contain multiple
sections, each with its own continuous evidence span.

The default `read-plan` is the authoring packet for ordinary documents. It
includes the payload contract, a compact canonical source-ref map, exact source
body resources, the recommended scratch path, and the direct stage command.
Do not separately request `schema`, `source-index`, or `existing-knowledge`
unless the packet reports truncation or the task specifically needs an existing
approved identity. Those views are diagnostics and large-source fallbacks, not
mandatory workflow steps.

Every `context.source-body/*` item selected in `workflow.current.resources`
is source evidence, not supporting metadata. Read the complete Markdown file
when its `read_state` is `read-required`. A source index, heading tree, token
count, or successful capture never substitutes for body reading. A matching
content digest receipt may be reused only while that text remains available in
the current conversation. After reading every selected direct path, execute the
single `resources.after_read.command`. For a generated Context View, execute
its materialization command, read its complete file, then execute its exact
`next_action.command`. Context carries the merged receipt file forward. A Route
revision change does not invalidate unchanged bytes, but every lifecycle
command remains revision-bound.

When the route returns `payload_target`, write the Agent-authored structure input
to its recommended `.tmp/agent-payloads/` path. This scratch area is separate
from CLI-owned `.tmp/context-runtime/` and can be discarded after a successful
stage. The recommendation does not restrict an explicit user-selected path.

Stage all required source/collection slots before batch Review. Structure
confirmation is an explicit gate. A confirmation applies only to the staged
slot digest shown by the route; if the digest changes, confirm again.

When the current Route exposes `batch`, author every listed target payload in
one Agent planning pass, then write the small batch manifest to `batch.input`.
Use `batch.validate.command` for a read-only all-target check or
`batch.stage.command` to validate every target before any stage begins and then
write the ready slots serially. The manifest contains only each `phase_id` and
its structure payload `input` path; it does not merge document semantics or let
the CLI choose page structure. A failed preflight writes no slot. If a later
filesystem write fails, the result identifies completed slots and the Route
remains recoverable.

`--stage` performs the same validation and deterministic self-repair as
`--validate`; use the separate validation command only for a diagnostics-only
pass. In a managed conversation, a valid stage also records structure
confirmation in the same write. Validation states are literal: `ready` may
stage, `repair-required` may not, and `invalid` contains errors. `valid` is true
only for `ready`; `error_free` distinguishes a blocker-only result from one
containing errors. `self_healed` reports the input and output Section counts,
how many original Sections were split, and the structural reason codes used by
the repair.

Independent read-only evidence views may run in parallel. Structure stage,
confirmation, compile writes, and Review application are serial lifecycle
mutations; execute them in the order selected by `workflow.current`.
