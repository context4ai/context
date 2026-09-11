---
id: procedure.parallel-agent-batch
kind: procedure
mediaType: text/markdown
---

# Parallel Partition and Author tasks

This procedure applies only to a current Partition or Author Action with
`tasks[]`. The Host runs the workers; Context does not launch models. The current
Route, required readings and output schema remain authoritative. Delegation does
not grant source access, approve a Gate or change the accepted scope.

## Choose execution once per batch

Use available native Host delegation only when current user/Host permissions
allow it, at least two independent tasks are ready, and workers can read the
assigned material and return their result without writing files. Respect an
explicit single-Agent preference and Host capacity or budget limits. Do not
install another agent runner, start nested CLI sessions or request broader
permissions just to parallelize. If these conditions are absent, continue the
same batch sequentially without a new user question.

Resolve any existing scope or human decision before dispatching dependent tasks.
Permission to use multiple Agents does not waive that decision.

Choose `min(4, ready task count, available worker slots)` concurrent workers,
excluding the coordinator. Use parallel mode only when that value is at least
two. Do not split one task or enlarge a CLI batch to fill slots. Schedule later
tasks from the same batch as workers finish; never prepare the next batch while
this one is active. Known dependencies between tasks require sequential handling
by the coordinator. A worker result never becomes evidence for a peer.

Tell the user briefly, in their language, how many planning or writing workers
will run when first enabling delegation or changing its concurrency/mode. Reuse
that announcement across unchanged batches. Report a fallback once when it happens. Worker completion is draft
progress; only CLI receipts establish accepted production progress.

## Single coordinator and read-only workers

The coordinator reads the Route, output schema and shared instructions, resolves
existing human decisions, and owns all Context commands, receipts and writes.
Workers consume only their assigned task reading and its authorized shared/detail
files and captured source access. Material requiring CLI preparation is requested
from the coordinator. Never let a worker run `context status`, a materializer,
preview, completion, capture, parser, review, close or build.

Use a Host read-only worker/tool profile when available. Workers must not run
shell commands, Git, scripts or other tools that can change files or external
state, and must not spawn workers. If the Host cannot honor this boundary, use
single-Agent execution. Workers return results through Host messages; they do
not write even scratch files. If a task cannot fit a complete response within
the Host's output budget, the coordinator handles it sequentially and writes
the payload itself. Do not truncate a result or publish a stub to fit transport.

The coordinator alone writes the final payload under the workspace's
`.tmp/agent-payloads/`, using a new file for each submission attempt. Never edit
runtime readings or ledgers. This prevents worker file collisions without
depending on filenames, worktrees or the project write lock to isolate them.

## Assign and collect

Use `template.indexer-agent-worker` from the current Route. Bind each assignment
in coordinator memory to the current Route revision, Action `input_digest`,
task manifest, instruction/resource digests and a unique attempt identifier.
Task keys repeat across batches, so `task_key` alone is not an assignment ID.
Copy these values; never compute or repair authority values from prose.

Send one task entry, its exact Route-provided reading location and applicable
shared instructions, the relevant output schema, and settled reader/scope
decisions. Give enough instruction content or exact resource locations for the
worker to read independently. A parent's reading does not populate a worker's
context or authorize an unread receipt. Do not broadcast the entire batch,
conversation, live repository or sibling task readings.

Keep a mapping from Host worker ID to assignment attempt. Before dispatch, choose
a finite task deadline supported by the Host (default ten minutes; shorten to
the remaining session budget). Wait using native completion notifications or
bounded waits while continuing user progress updates. A deadline is a Host
execution limit, not a statement that evidence is missing.

Accept a reply only from the active attempt for that task and only after it is
complete. The worker uses the template's Host reply envelope to echo assignment
identifiers separately from its single `{task_key, result}` entry. Check the Host
worker ID and that binding against the saved assignment;
do not insert coordination metadata into the Context semantic Result. Retain
successful drafts in coordinator memory until the batch is assembled.

## Merge and submit

Reconcile Partition proposals against the settled reader purpose and accepted
subjects, especially overlapping identities, primary member ownership and
unresolved cross-task boundaries. Do not silently rename a subject or discard a
member to make proposals fit. Resolve disagreements from authorized material
in the coordinator; use the current schema's unresolved outcome when necessary.

For Author, review consistency with the accepted page plans, evidence boundaries
and reader terminology. A task may contain several planned articles: assign the
whole task, not independent writers for its sections or articles. CLI performs
the existing schema, ownership, reference and coverage validation.

Assemble one entry per current task in task-key order, keeping the normal
single-Agent output shape. Use the current Author preview when needed, then
submit the complete batch once through the saved revision-bound command. Do not
submit as each worker finishes or turn Host errors into `unsupported`,
`catalog-only` or empty semantic results. Resolve unfinished work locally first.

Finish or revoke every active assignment before any command that may change the batch or its material.
Do not poll status merely to check workers. The revision-bound CLI command is
the final freshness check; if an external change is observed, invalidate the
assignments and obtain the current Route before submitting.

## Failures and sequential fallback

| Event | Coordinator action |
| --- | --- |
| Delegation unavailable, denied, or capacity below two before dispatch | Execute the batch sequentially. Do not retry permission prompts or simulate workers. |
| Spawn failure, rate limit, timeout, tool failure, context loss or truncated reply | Stop dispatching for this batch. Revoke the failed attempt, cancel/close it if supported, and finish that task and unassigned tasks sequentially. Let healthy read-only peers finish within their deadlines. |
| Missing/foreign task key, wrong attempt/revision, malformed or incomplete result | Discard that reply; take over its task sequentially using the original authorized input. Do not repeatedly respawn or treat the draft as committed. |
| Conflicting proposals | Reconcile affected tasks in the coordinator; preserve unaffected drafts. Unresolved scope decisions follow the existing human Gate. |
| Worker attempts a write, unauthorized tool or source access | Revoke all workers and stop parallel dispatch. Inspect any reported effects before continuing. If workspace integrity or authority is uncertain, follow current recovery guidance or report the concrete blocker. |
| Route, task set or material binding changes | Revoke old attempts; discard incompatible drafts and follow the fresh Route. Never relabel an old reply with new digests or task keys. |
| CLI accepts only part of a submission | Read `outcomes` and the returned next Route/task-only retry. Preserve committed peers; repair only the returned unfinished tasks sequentially. |
| Completion reply is lost or next preparation fails | Inspect current status or the supplied recovery command before retrying. Accepted tasks may already be saved; never blindly replay the payload. |
| Project write lock is held | Wait for the active writer using existing recovery guidance. Never remove its lock or launch another writer. |

Revocation means marking the attempt inactive before taking over. Ignore all late
replies, even if cancellation is unsupported. Such workers remain read-only;
do not reuse their slots until the Host confirms termination. Do not start a
new parallel batch while revoked workers are still active. A revoked read-only
worker does not block the coordinator's sequential takeover or completion;
its obsolete reply can no longer be accepted. If its read-only boundary is in
doubt, use the violation handling above instead. After any execution
failure, keep the rest of this batch sequential and reassess capability only at
the next fresh batch. A user request to stay single-Agent persists.

Sequential fallback preserves evidence, scope, review and completion requirements.
If the coordinator also cannot complete the task, retain drafts and report the
actual missing material, permission or Host limit through the existing workflow.
Do not clear runtime state, widen sources or lower coverage to force progress.
