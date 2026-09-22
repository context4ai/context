# Tools for planning research

Use tools and credentials already available in the selected environment. Inspect
their advertised commands and help before invoking an unfamiliar operation;
capabilities can vary by installation. A missing command is a capability gap,
not permission to invent an endpoint or bypass the source's access controls.

## Source inventory and selective capture

Prefer supported directory listing, batch capture, persistent progress and
resume capabilities. Store reusable output in the plan's scratch directory.
Keep listing results distinct from captured bodies and capture failures distinct
from denied resources. Source type determines the appropriate document, table,
board or file adapter; do not force every source through a document-only API.

Where the installed tool supports bounded concurrency and rate-limit handling,
let it schedule independent reads and honor its retry/backoff results. Avoid
agent-written parallel shell loops that bypass those controls or concurrently
write shared Context state. If only narrower operations are available, use
bounded batches, persist their receipts, and report the capability limitation.

Continue using the existing Context entry and its returned commands for official
registration, capture and knowledge production. Planning scratch downloads are
research inputs, not a substitute for an accepted source snapshot. Do not put
research files directly into `sources/` or `knowledge/`.

## Capture once and reuse in a production stage

For an authorized Lark document, download a complete local snapshot before a
Context workspace exists:

```bash
context source fetch lark https://example.larkoffice.com/docx/example-token \
  --output .tmp/context-plans/20260101-handbook/documents/handbook \
  --as bot --format json
```

The destination must be new. This operation does not register a source, create
a production task, or write managed workspace state. It uses one fixed identity
(Bot by default), including embedded resources; it never switches to User on
failure. Use `--as user` only when authorized to read with that identity. Existing
host authorization may then require consent. Inspect the fidelity and resource
diagnostics: a retained reference or preview is not the complete missing resource.
Rate-limit handling and supported same-identity representations use the ordinary
capture machinery.

Keep the whole returned `snapshot_dir`, including `snapshot.json`, document,
raw responses and assets. The receipt is local integrity and capture provenance,
not a platform signature or proof that the upstream document is still current.
Do not replace a response with a summary or edit the receipt to hide gaps.

After plan approval, register only the selected stage's source through the
existing workflow. Then use the matching registered name in an import file:

```json
{
  "type": "lark",
  "name": "20260101/handbook",
  "snapshot_dir": ".tmp/context-plans/20260101-handbook/documents/handbook"
}
```

```bash
context source import --input .tmp/context-plans/20260101-handbook/stage-inputs/import.json --format json
```

Paths in the payload are relative to the selected Context workspace; use its
actual registered source name and an allowed local location. When moving between
workspaces, copy or move the complete snapshot to the selected workspace's
scratch directory. Snapshot entries must be real files, not symbolic links.
Import validates the source identity, saved responses, digests and resource
files through the normal capture write path. It preserves the original capture
time and revision and makes no remote calls, including for structured resources.
If the stage has a different resource policy, use its normal capture operation
or explicitly reconcile that configuration; do not edit the saved receipt to
pretend it was captured under a different policy.
If the stage needs a newer source revision, fetch a new snapshot to a new directory
instead of describing the saved one as fresh. Existing `response_files` import
remains available, but may still fetch resources absent from those responses;
use an intact `snapshot_dir` for complete local reuse.

`context source discover lark` provides resumable Wiki directory discovery in an
existing Context workspace. It does not fetch bodies or register the inventory.
When no workspace exists, use the available source platform's authorized listing
capability; do not invent a workspace-free discovery flag or initialize a full
production scope only to list a directory. Batch registration and its checkpoints
belong to the selected production stage, not the full planning inventory.

## Repository research

Reuse an existing authorized checkout at the requested revision. Read metadata
and selected paths before deciding whether more objects or files are needed.
For a new checkout, use the source platform's supported clone/read capabilities
and save the resolved commit in the PLAN. Keep remote read results tied to that
same commit, and fetch additional content only when the research requires it.

Respect uncommitted work in reused checkouts. Do not reset, replace, rebase or
switch a user's active worktree just to change the planning baseline. Use an
available read-only view or an authorized separate research checkout when the
required revision is unavailable locally.
