---
id: context.sdk.source-batches
kind: procedure
mediaType: text/markdown
---

# Resumable source operations

These optional commands improve source discovery and registration. They do not
select a production scope, capture document bodies, approve articles, or change
the current workflow. Existing single-source and batch commands remain valid.

## Register a large batch

Use the existing batch payload and add checkpoints when recovery is useful:

```bash
context source add batch 20260101 --input .tmp/sources.json --checkpoint --progress --format json
```

The final JSON retains `kind`, `namespace`, `total`, and `registered`. When
checkpoints are enabled, `checkpoint` also provides `job_id`, `status_command`,
and `resume_command`. Progress is bounded JSON on stderr; stdout contains the
final receipt. Without `--progress`, existing output behavior is retained.

```bash
context source batch-status <job-id> --format json
context source add batch --resume <job-id> --progress --format json
```

The saved input remains under `.tmp/context-runtime/source-batches/`. Resume
validates and replays every input against the current registry; a saved cursor
is advisory and never authorizes skipping validation. Resume does not require
the original payload file. It registers sources only; `--configure` remains an
explicit choice. Do not combine `--resume` with a date or replacement input.

Batch registration retains partial-success semantics. Valid entries before a
failed item remain registered, and the error identifies completed entries and
the failed position. Lark entries are validated in memory and committed in
bounded atomic chunks. Repository and file entries retain their existing
registration checks. An unchanged chunk does not rewrite its registry.

Checkpoint initialization is checked before registration starts. If later
progress storage becomes unavailable, successful registration remains successful
and the receipt includes a warning. A missing progress file does not prevent
replaying an intact saved input.

Only one workspace writer may run at a time. Poll an active command rather than
starting another writer or deleting its lock. Normal cancellation finishes the
current bounded write and releases the lock. Forced termination can leave a
stale lock; follow `context task recover --format json` before resuming. A saved
checkpoint survives process restarts in the same workspace, but not deletion of
its temporary directory or a new workspace without those files.

## Discover a Wiki directory

For an explicitly authorized Wiki subtree:

Run discovery from an existing Context workspace. It saves research metadata
without changing the source registry or production scope.

```bash
context source discover lark https://example.larkoffice.com/wiki/example-token --as bot --format json
context source discover lark https://example.larkoffice.com/wiki/example-token --as bot --resume --format json
```

Discovery saves directory metadata, object identities, aliases, and page receipts
under `.tmp/context-runtime/wiki-discovery/`. It reads neither document bodies nor
their external links, and does not register sources or create capture phases.
The result gives the manifest path and counts instead of printing the whole tree.

The identity defaults to Bot and is fixed for the job. Bot reads never switch to User credentials.
Permission failures are recorded without prompting for authorization or stopping
independent directories. Completed pages are reused; explicit resume retries
transient failures. The manifest describes the observed scan, not an atomic
snapshot of a remotely changing Wiki.

Explicit `--as user` uses the host's existing user-authorization behavior, which
may request consent when credentials or scopes are missing.

`--concurrency` accepts 1 through 4 and defaults to 4. Rate limits reduce active
concurrency and apply bounded retries with a shared cooldown. Exhausted retries
leave a resumable partial result. Progress goes to stderr by default; use
`--no-progress` to disable it. `completed`, `partial`, and `paused` distinguish
the outcome; partial or paused discovery exits nonzero while preserving results.

Existing jobs require `--resume` and the same identity. A running discovery owns
its job lease; a second invocation cannot overwrite it. Discovery does not hold
the workspace source-registration lock.
