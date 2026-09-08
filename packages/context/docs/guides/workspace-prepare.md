# Prepare a workspace for the next task

Use only for an explicit workspace preparation request. The goal is usable
registered sources and no unfinished task, while retaining approved knowledge
and configuration. Lead with Host tools and actual observations; do not start
indexing merely because a status response offers production work.

## Establish the scope

Use `context entry` to locate the workspace. Inspect current work, active
processes, Git changes and source registrations. Explain which unfinished
drafts and queued maintenance will be discarded. Reuse the user's explicit
authorization; ask only about an unresolved loss, version or access boundary.
Wait for an active writer to finish and obtain its receipt before changing state.
If status is broken, inspect its diagnostic and files with Host tools rather
than treating failure as proof that the workspace is empty.

## End the old task

Run `context task prepare --format json`. It previews the exact Context-owned
task files, including production, Review and maintenance state. It preserves
approved pages, source records and snapshots, project configuration, repository
checkouts, other `.tmp` files and existing outputs. It does not claim the output
or sources are current.

Once discarding the shown scope is authorized, execute the returned apply
command with its plan digest. If the preview changes, inspect the new differences.
On interruption, rerun the preview and use its resume command; never clear a
transaction journal or repeat old Author submissions. Other incomplete writes
must be recovered before cleanup. The completion clears task state only; check
sources next. Do not manually delete the runtime directory to emulate this action.

Other caches are optional cleanup, not a requirement to empty `.tmp`. Inspect
their ownership and recoverability before deleting them with Host tools. Keep
reports, unique material, unknown files and modified checkouts unless their
specific loss is authorized. Do not delete locks, transaction records or active
tool directories. Empty task directories can remain.

## Restore usable sources

For repositories, run `context source recovery-plan --format json` and read
the installed repository recovery procedure and schema supplied by entry's
workflow bundle: `repository-source-recovery.md` beside this guide and
`../../schemas/repository-source-recovery.schema.json`. Reuse a matching local
checkout or, when authorized, clone into a bounded location using
`context source restore --input <workspace-input-file> --format json`.
Group modules sharing a remote and fixed commit; do not clone per module.
Check registered commit and module paths. Never reset a supplied dirty checkout.
Authentication or checkout problems can be diagnosed with Host Git tools;
refresh the recovery plan after fixing them. Do not substitute a newer commit.

For Lark, inspect the stored body and required attachments against the source
records. Use the Host's document tools and the [existing capture guide](knowledge-updates.md)
to repair missing material, retaining the registered identity. A current remote
response is not proof of an older snapshot: if it differs, explain that source
updating is needed and resolve that choice before claiming recovery. If an old
snapshot is unavailable, report the exact limitation. Do not automatically
follow every document link or reread already complete materials.

For note, sessions and local files, preserve formal source content and verify
that declared paths can be read. Do not reconstruct lost original sources from
generated knowledge or scan arbitrary local directories.

## Finish

Verify that no task files remain in the preparation preview, no writer remains,
the required configuration can load, and selected sources resolve to their
registered versions and paths. CLI inspection or direct Host checks are both
valid; a failed check is not ready. Report outstanding blockers and their next
action. Stop when ready for the next user request, without running Author or
recapturing everything. Historical restoration may additionally require a
close/build; see [restore a version](workspace-restore.md).
