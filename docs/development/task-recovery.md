# Task recovery

`context task recover --format json` is an independent entry for an existing
workspace. It reads the task ledger, accepted-plan checkpoint, transaction
inventory and writer owner separately. It does not execute `src/index.ts`, parse
sources or evaluate the normal workflow Route. One unreadable area becomes a
finding while other areas remain visible. The result points to the packaged
`recover-workspace` internal Skill and sanitized issue template.

The Context Skill recognizes a recovery intent. The Provider also has a separate
`workspace/recovery` entry; its read action selects the same Skill and resources.
This does not add an unconditional production Gate. If the CLI cannot run at all,
the main Skill contains a minimal issue-report fallback.

| Operation | Effect |
| --- | --- |
| `inspect` (default) | Read-only diagnostics; never implicitly unlock or replay transactions |
| `author` | Preview and reopen selected Author worksets with correction instructions and new request identities |
| `plan` | Reopen selected work from the active accepted planning baseline, when its guards still match |
| `transactions` | Preview and finish existing durable transaction journals without requiring status to work |

Mutation requires `--apply --plan-digest <current-preview>` and the same selection
and instruction. A digest binds state, not user permission. The Agent checks the
preview's complete affected scope against the current authorization; normal
repair of authorized unfinished work needs no extra ceremonial confirmation.

Author recovery follows explicit planned article dependencies transitively. It
preserves unrelated ledger entries, accepted result stores, remaining candidates,
source/configuration files, `src/knowledge-map.yaml`, approved knowledge and existing
packages. It invalidates affected Composer pointers and shared batch/delivery
projections. Their next evaluation uses the new request identities. All changed
pointers, candidate records, new requests and local recovery archives are committed
through the existing multi-file transaction engine. An interrupted apply is
completed by the transaction recovery operation; do not replay the old payload.

After structure approval and Author preparation, a best-effort reference checkpoint
is written at `.tmp/context-runtime/indexer/recovery/accepted-plan.json`. It refers
to existing immutable requests and shared template snapshots. It is not a second
long-term planning file and does not copy source repositories or parser outputs.
The same accepted revision does not silently replace its baseline. Failure to
save this auxiliary checkpoint warns without blocking production. A new accepted
plan replaces it; normal lifecycle cleanup removes it and local repair archives.

Plan restoration is deliberately unavailable when the registered source,
configuration or approved-knowledge baseline has changed. Accepted work also needs
a matching baseline before draft recovery; pages already approved before close
are protected using compile ownership and file presence. Use ordinary page
revision for delivered work. Missing/corrupt ledgers, missing immutable requests,
ambiguous draft ownership and inconsistent journals are reported, not reconstructed
by guessing. Recovery does not select arbitrary historical plans, undo Git commits,
or bypass a living writer's lock. External edits to captured snapshots still need
the normal source/verification flow.

When recovery cannot proceed safely, the Agent writes a locally dated semantic
filename under `issue/`, using the packaged template. The Agent summarizes and
redacts evidence before sharing: no raw archives, payloads, credentials, personal
paths, private URLs or source/document bodies. Creating the report does not upload
it or declare the task recovered. The report names preserved outputs, attempted
repairs and the specific remaining developer investigation.

Verification covers corrupt-state inspection, stale previews, planning restoration
with fresh requests, guarded source/configuration changes, interrupted transactions,
current candidates and approved-page protection. Existing revision/streaming tests
exercise the surrounding production path.
