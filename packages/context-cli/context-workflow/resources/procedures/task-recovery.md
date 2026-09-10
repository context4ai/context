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
- Failed Author work: preview `task recover --operation author --workset <digest...>
  --instruction <concrete correction> --format json`. Explicit article dependencies
  can expand the affected worksets. Read the entire affected scope before applying.
- Restore the active accepted planning baseline: use `--operation plan` with the
  same selection/instruction arguments. The checkpoint contains references to the
  already stored immutable requests, not copies of all source or parser data. It
  is available only after structure acceptance and is removed by lifecycle cleanup.
  A changed registered source/configuration/approved-knowledge baseline prevents
  restoration; use normal revision or replan instead. It does not recover deleted
  runtime data from Git or choose arbitrary historical versions.

The preview lists affected worksets and discarded candidates. Within an explicit
repair task or delegated authorization covering those unfinished drafts, explain
that scope and apply without another ritual approval. Obtain a decision only if
the expanded scope discards work outside that authorization. Never treat a digest
as permission to undo published knowledge. CLI validates mechanical identities,
references and transaction consistency; the Agent diagnoses prose and planning.

A repair changes request identities, archives replaced local draft/projection state,
and preserves approved pages, menu, sources and existing packages. Read the fresh
Route after success; do not reuse old task keys/results. Unrelated accepted results
stay valid. Rebuilding whole-batch projections is not re-authoring their content.
Do not silently exclude a failing module, weaken evidence or mark unfinished work
complete to escape an error.

## Stop a repair loop and report

If the same cause persists after a correction without new evidence, do not repeat
the same operation. Try a different supported recovery only when its prerequisites
and effect justify it. If the ledger/checkpoint is unreadable, ownership cannot be
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
