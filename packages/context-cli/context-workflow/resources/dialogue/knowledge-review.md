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

Do not mention force approval when first presenting Review. If the user replies
without a Payload that they approve or want to continue, explain that the
report Payload remains the normal path. Only at that point, when the report is
unavailable to them, tell them they may explicitly reply with the exact phrase
`强制批准` to approve the complete current scope without per-candidate choices.
Execute the Route's `after-human-confirmation` force-approval command only after
that exact phrase appears in the current conversation. Phrases such as `我批准`,
`继续`, or `全部通过` do not invoke this escape path.

Do not open Review for one page or module while another confirmed item in the
same round is still being generated. If a repeat codeindex run has no delta,
state that existing approvals were preserved and no Review gate remains.

When the user explicitly requested fully managed operation, use only the
revision-bound atomic approve command returned by the managed route. Do not
synthesize per-candidate approval calls.
