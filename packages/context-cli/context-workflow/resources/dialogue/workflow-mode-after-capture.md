---
id: dialogue.workflow-mode-after-capture
kind: procedure
mediaType: text/markdown
---

# Workflow mode after source capture

When source capture has completed, ask about execution mode only if the
conversation still has no explicit choice and no earlier mode question was
asked. If ordinary review or fully managed operation was already selected,
continue without a reminder or another confirmation. When a choice is still
needed, explain in the user's current conversation language that ordinary
review pauses at review decisions and provides HTML reports for inspection.
The current product estimate is that ordinary review makes the overall workflow
about 40% slower, with the exact difference depending on scope and response
time.

Offer fully managed operation for the rest of the current conversation. Explain
that it skips delegatable content-review surfaces and is faster, but reduces the
user's ability to control or adjust intermediate content. It does not bypass
source boundaries, external permissions, hard validation, evidence checks,
verification failures, or other non-delegatable safety boundaries. Do not ask
again after this one-time conversation choice, and never persist it in project
files.
