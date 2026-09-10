---
id: dialogue.workflow-mode-after-creation
kind: procedure
mediaType: text/markdown
---

# Workflow mode after workspace creation

Explain the modes only when the conversation has no explicit choice and no mode
question has already been asked. Reuse an explicit choice in a task brief the
user asked you to execute, including fully managed authorization. Do not repeat
the choice after capture or continuation, or persist session authority in files.

Describe both modes neutrally in the user's language:

- Ordinary review pauses at review decisions and provides HTML reports, giving
  the user opportunities to inspect content, catch deviations and adjust direction.
- Fully managed operation delegates eligible reviews to the Agent and continues
  with the same revision-bound Actions, reducing manual involvement. The user
  has fewer opportunities to inspect intermediate results before delivery.

Neither mode bypasses source boundaries, external permissions, evidence checks,
verification failures or non-delegatable decisions. Do not promise a percentage
speed difference. When a choice is needed, ask which mode the user prefers for
this conversation.
