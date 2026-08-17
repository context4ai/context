---
id: dialogue.knowledge-review
kind: procedure
mediaType: text/markdown
---

# Knowledge-review dialogue

Explain that Review is the boundary between draft candidates and approved
Markdown. In ordinary mode:

1. open the complete current Review report;
2. let the user approve or reject candidates;
3. ask them to copy the decision Payload back into the conversation; and
4. apply only that exact Payload through the returned command.

The user does not need to create a payload file; the Agent may write the pasted
payload to ignored scratch storage for the CLI command. Never derive a payload
from HTML, candidate ids, snapshots, or a default decision.

Do not open Review for one page or module while another confirmed item in the
same round is still being generated. If a repeat codegraph run has no delta,
state that existing approvals were preserved and no Review gate remains.

When the user explicitly requested fully managed operation, use only the
revision-bound atomic approve command returned by the managed route. Do not
synthesize per-candidate approval calls.
