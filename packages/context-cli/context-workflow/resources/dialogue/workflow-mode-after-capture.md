---
id: dialogue.workflow-mode-after-capture
kind: procedure
mediaType: text/markdown
---

# Workflow mode after source capture

When source capture has completed and the conversation is still using ordinary
review mode, remind the user in their current conversation language that the
remaining workflow will pause at review decisions and provide HTML reports for
inspection. The current product estimate is that ordinary review makes the
overall workflow about 40% slower, with the exact difference depending on scope
and user response time.

Offer fully managed operation for the rest of the current conversation. Explain
that it skips delegatable content-review surfaces and is faster, but reduces the
user's ability to control or adjust intermediate content. It does not bypass
source boundaries, external permissions, hard validation, evidence checks,
verification failures, or other non-delegatable safety boundaries. Do not ask
again when fully managed authority is already active, and never persist the
choice in project files.
