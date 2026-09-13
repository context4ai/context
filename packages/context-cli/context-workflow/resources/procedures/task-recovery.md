---
id: procedure.task-recovery
kind: procedure
mediaType: text/markdown
---

# Recover a stuck task

This is an independent internal recovery entry. Start with
`context task recover --format json`; do not require normal status to succeed,
initialize a second workspace, or replay a saved workflow revision. Read available
areas even if another area is corrupt. Do not interpret elapsed time alone as a
stalled process: wait for a currently running command's receipt and check whether
its progress is changing. Never start a competing writer or delete a writer lock.

## Choose the smallest applicable action

- Wrong current payload: use the reported schema/evidence to correct it and refresh
  the Route when available. A current candidate can use its ordinary revise action.
- Interrupted transaction: preview `task recover --operation transactions`, inspect
  the recorded effect, then apply its digest when completion of those writes is
  authorized. This finishes prior writes and may touch approved knowledge; it is
  not draft rollback. Invalid journals or unclear ownership require escalation.
- Failed writing: repair the reported article or fragment in the current stage
  directory and resubmit its files. Accepted peers remain valid. If the selected
  article has already been accepted, use its ordinary `context revise` action.
- Changed materials or plan: use the current preparation or plan-amendment route.
  There is no separate workset/accepted-plan restoration operation. If temporary
  state has been removed, begin a new production run from formal content and
  long-term requirements; do not reconstruct old candidates or process state.

The transaction preview lists affected files and previously started writes.
Complete them only within existing authorization. Never treat a digest as
permission to undo published knowledge. CLI checks current task identities,
references and transaction consistency; the Agent diagnoses prose and planning.

A task refresh may change its input identity; use the refreshed files and receipt.
Ordinary failed-draft repair retains the task when its inputs are unchanged.
Approved pages, navigation, sources and existing packages are not discarded by
inspection. Unrelated accepted results stay valid.
Do not silently exclude a failing module, weaken evidence or mark unfinished work
complete to escape an error.

## Stop a repair loop and report

If the same cause persists after a correction without new evidence, do not repeat
the same operation. Try a different supported recovery only when its prerequisites
and effect justify it. If the current stage is unreadable, ownership cannot be
established, the baseline changed, or a CLI defect prevents safe recovery, retain
current work and write `issue/YYYY-MM-DD-short-description.md` using
[the issue template](../templates/recovery-issue.md). Use the user's local date and
a short semantic filename; update an existing report for the same incident rather
than producing one per retry. This grants report creation only, not arbitrary
workspace/runtime edits. Do not overwrite an unrelated existing report.

Read diagnostic context locally, then summarize and redact it. Replace people,
private repositories, module names and absolute home paths with stable aliases;
remove tokens, cookies, authorization headers, signed URL queries, personal data,
and source/document/chat bodies. Keep error codes, schema names, stage, counts,
anonymous dependency shapes and relevant version/platform facts. Command examples
must use placeholders for private arguments and secrets. Do not attach full debug
logs, environment dumps, checkpoint archives, payloads or source snapshots.
Review the report for remaining sensitive content before showing its clickable
path to the user. Share with Context developers only when the user authorizes it.
State that the issue remains unresolved and identify preserved results and the
specific next developer/user action. An issue report is not a recovery receipt.
