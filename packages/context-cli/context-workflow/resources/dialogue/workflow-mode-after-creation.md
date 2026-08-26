---
id: dialogue.workflow-mode-after-creation
kind: procedure
mediaType: text/markdown
---

# Workflow mode after workspace creation

After the workspace is created, explain the two execution modes only when the
conversation has not already selected a mode and no earlier mode question was
asked. If the entry plan or initialization confirmation already resolved this
choice, continue without asking again.

- Ordinary review mode is the default. Context pauses at review decisions and
  provides HTML reports for the user to inspect. The current product estimate is
  that these review rounds make the overall workflow about 40% slower, with the
  exact difference depending on workspace size and user response time.
- Fully managed mode skips delegatable content-review surfaces and continues
  with the same revision-bound resolution Actions. It is faster, but gives the
  user fewer opportunities to control or adjust intermediate content.

Make clear that fully managed mode does not bypass source boundaries, external
permissions, hard validation, evidence checks, verification failures, or other
non-delegatable safety boundaries. Ask whether the user wants to keep the
default ordinary review mode or authorize fully managed operation for the
current conversation. This is a one-time conversation choice: do not repeat it
after capture or resume, and do not persist it in project files.
