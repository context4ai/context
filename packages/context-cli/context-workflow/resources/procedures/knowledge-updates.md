---
id: procedure.knowledge-updates
kind: procedure
mediaType: text/markdown
---

# Update existing knowledge

Use the same Context conversation and the current workspace. Identify whether
this is a continuation, an adjustment to the current task, a correction to one
page, or an independent task. An old Route does not incorporate a new request.
For explicit workspace preparation, Git commit or historical restoration, use
[prepare](workspace-prepare.md), [commit](workspace-commit.md) or
[restore](workspace-restore.md); these Agent-led operations do not automatically
start production. Otherwise, do not start an independent task while another remains: explain what is saved
and unfinished, and obtain the user's choice to finish or roll back the current
work. Do not delete runtime files to simulate rollback.

For an unambiguous page correction, use `context revise "<path or title>"
--instruction "<correction>" --format json`. Context supplies the existing text
and continues through Review and delivery. Expression-only changes need no
source capture or Parser. Preserve prior confirmed contributions; distinguish
actual behavior, a confirmed decision, and a proposal that is not implemented.

## Edit one section or review part of a batch

The current approved-revision Route accepts either full `markdown` or explicit
`sections` edits. Use an existing `writing_context.current_sections` ID and an
ordered `content` list of `{ "markdown": "new text" }` and/or
`{ "program": "exact current program token" }`. Unchanged sections and the
selected section's source references remain intact. Use full Markdown when
changing structure, adding a page or when a section has no unambiguous ID.

For an optional check, append `--preview` to the current `action complete-current`
command with the same revision and input file. It validates and returns the
assembled page and previous text without accepting the edit. Submit the same
input without that flag to continue. A preview is not approval and does not make
a stale revision valid.

Review can approve checked pages while leaving repair pages pending. The HTML
review code includes pending positions; managed Review provides the same current
scope as a JSON template. Send decisions only for pages actually reviewed. Omit
means a durable exclusion, not repair. Partial approval alone does not build.

When the user requests an earlier delivery, use the Route's `context run
--deliver` request. Independently approved pages can pass close/build while
pending candidates remain for Review or repair. Links to pending or missing
pages keep their necessary scope together. Source processing baselines advance
only after the entire update finishes. Failed builds retain the selected delivery
and pending work; repair the cause and follow the current Route.

## Acquire the selected change once

Use the host's existing Git, code-hosting or document tools and their installed
guidance. Context does not poll a platform, discover remote changes, or infer
that a merge request is merged. Reading an already selected source does not
require a new permission question when access was already authorized. Do not
change the user's checkout or fetch another repository without that scope.

For a branch or MR/PR, establish the repository, intended target branch, merge
state and actual fixed target commit. An unmerged proposal is not the current
mainline. A merge, squash or rebase can produce different commit identities;
use the target branch's actual result, not the feature branch SHA. Include
other intervening changes between the last processed version and the selected
target when they affect the registered modules. Reverts are real changes.

Use already available local Git objects to compare the selected module trees
and necessary diffs. A new repository commit with unchanged module trees can
be a no-knowledge-change conclusion. That conclusion must also account for any
new note or development context. If a baseline is unavailable after force push,
a shallow checkout or history cleanup, state that a complete old diff is
unavailable; compare current material with approved knowledge in the confirmed
scope. Do not claim no change because a Git command failed. A repeated MR may
still bring new relevant context; it does not justify moving the code baseline
backwards or summarizing unrelated commits as part of that MR.

For documents, a revision shortcut is valid only if the host actually exposes a
reliable version for the selected document and its needed images/attachments.
Otherwise read that selected document and resources. Keep the returned bytes
for the existing capture/import action; do not fetch them again as verification.
An unchanged body does not prove images are unchanged. Distinguish lack of
permission, deleted content, and moved content; a read failure is not permission
to retire a knowledge page. CLI status describes local acquisition only.

After the current source configuration and material identify the chosen fixed
versions, submit the update with `context update --input <file|-> --format json`.
Write ordinary YAML or JSON with the host's editor, without a generated wrapper
program. Input files belong under this workspace's `.tmp/`.

```yaml
scopes:
  - requirement_ref: reader-guide
    source_ref: repo:20260901/library
changes: The selected change adds one public option; inspect its explanation and examples.
```

`requirement_ref` is the existing requirement id. Omit `module_refs` for a whole
confirmed source scope. `processed_version` may be supplied to bind the exact
acquired commit or document content digest; otherwise Context captures it from
the existing local material. A supplied version must match that material.
Follow the returned Route. The candidate list is a conservative source match,
not a list of pages that must change. Read the actual change and current pages,
also checking additions that have no old page reference. The scope is complete
only after every required change is reviewed, closed and built, or after an
explicit conclusion that it needs no knowledge changes.

Before importing a `note`, read [note source preparation](note.md).
Before importing `sessions`, read [development summary preparation](sessions.md).
Choose the reference for the actual input; do not read both by default.

## Save text without an external file

Use `context source import --input <file|-> --format json`:

```yaml
type: note
name: 20260907/decision-context.md
markdown: |
  # Decision context

  The selected discussion confirmed this exception for the stated situation.
  The implementation has not yet changed. Source: the discussion supplied here.
```

The body is saved directly under `sources/note/` or `sources/sessions/`; no
external `local`, capture, registry or second copy is required. Use a readable
semantic filename under an eight-digit date directory. Do not put a date, hash
or session id into the filename again. Keep the path for retries and later
edits. To revise an existing source, read it and pass its current `base_digest`
with the replacement Markdown. Distinct same-day material needs a distinct
semantic name, never a silent overwrite. `source list`, `source get` and
`source inspect` expose the actual source paths. Removal uses the existing
preview and exact plan digest, and refuses still-referenced text.

Saving alone does not start indexing. If the user only wants the source saved,
report its path and stop. For production, reuse the existing requirement:
put independent content in `target_scope`; put supporting material in
`evidence_source_scope` and ensure the selected Indexer's existing `read_scope`
covers it. Do not create a separate Markdown production target for a supporting
explanation of a code page. In the source-update decision, include its exact
`supporting_sources` on the affected page. Include that source's scope in this
update so completion can distinguish code from newly processed context.

## Development context accompanying a commit

Use `trace-session` only as this conditional source-preparation step. If the MR,
code and existing design already explain the relevant information, cite them.
Write a `sessions` source only when real, explicitly available development
context contains useful decisions, reasons or limits missing from those sources.
Do not fabricate discussion from a diff, search host session storage, ask for
nonessential history, or create an empty/skip report. This is only the code-related subcase. An authorized conversation summary
without an MR or commit is also `sessions`; see the sessions source guide.
Optional `changes` belongs in the source frontmatter, not knowledge headers.

Use the available merge date, or commit date for a pure commit, for the initial
directory; if unavailable or saving an unmerged discussion explicitly, use the
current collection date and explain the context. Do not query a platform just
for this date. Keep the path when later adding a reference or retrying another
day. One coherent change can share one summary; separate unrelated changes.

The shortest useful body is the real repository/MR/commit reference plus one
paragraph explaining what the code does not tell a later reader. Describe only
the actually associated commit subset. Omit a full change recap, transcript,
test log, session id and formal approval claim. Write confirmed decisions as
such, alternatives as alternatives, and unresolved proposals as unresolved.
Do not claim execution or tests that were not observed. The writing aid below
is optional; no section is mandatory:

```markdown
# <Change topic>

<Reference the actual repository and MR or concrete commits already available.>

<Explain the useful decision, reason or constraint absent from the code/design.
State its applicability and distinguish implemented behavior from a proposal.>
```

Late context can update a page even when the code version is already processed.
Reuse that fixed code version and current approved prose; do not restart Parser
merely because a summary arrived. Import once, then include the necessary
context with the same knowledge update. Saved context survives a failed build;
saving it does not mean its knowledge impact has been delivered.

## Optional correction of an upstream document

Local knowledge approval and fully managed execution do not authorize a remote
write. First determine whether the knowledge misunderstood correct source text,
a confirmed decision has not reached the source, or the conclusion is still
uncertain. The first needs only a local correction; the second can use a note
locally while an upstream change is considered; uncertainty is not a fact.

Present the exact document, affected passage, proposed before/after text, reason
and affected knowledge. Reuse existing authorization for that concrete edit;
otherwise ask for it. Before writing, read the affected passage again using the
host document tool. Adapt only within the authorized scope if another person
has edited it; ask again only when the requested change materially differs.

Execute with the host tool and read back the result. If the write result is
uncertain, read back before retrying an insertion. Only the actual returned
source text and resources may refresh its snapshot. Feed them into the same
local capture/update route; a note or proposed patch is not a remote snapshot.
If the remote edit succeeded but local build failed, resume local delivery;
do not repeat the remote edit. Explain remote and local outcomes separately.
Do not automatically delete an absorbed note, post comments, notify groups or
change permissions. Permission failure can leave a concrete suggestion for
the user without blocking an independently supported local correction.

## Import a document response already read by the host

For a registered Lark source, retain the actual full JSON response from
`lark-cli docs +fetch` and each returned continuation page. Do not reconstruct a
response from a summary. Use the same source import command:

```yaml
type: lark
name: 20260907/guide
access_identity: user
response_files: [.tmp/guide-response.json]
media_files:
  actual-image-token: .tmp/downloaded-image.png
```

Only include real media tokens and downloaded files. Context runs the ordinary
capture normalization and resource checks on these bytes. It does not fetch the
provided document again; missing required resources follow existing capture
handling. Partial outline/section fragments cannot replace a full snapshot.
Use the identity that actually produced the response, not a credential fallback
chosen to bypass permissions. Subsequent local updates use the captured version
and the same Review/build route.

## Adjust or roll back current work

For an explicit same-task change to native Indexer source inputs, use
`context task adjust --input <file|-> --format json` with `scopes` containing the
selected `source_ref` and optional `module_refs`, plus an `instruction` explaining
the adjustment. It invalidates those old worksets and retains independent work.
Import the fixed replacement material before following the refreshed Route.
Do not execute the old batch payload. A local page correction still uses
`revise`; it is not a reason to invalidate an entire source.

For an independent task, complete the old Route unless the user chooses a
concrete rollback. Without an identifiable baseline or attribution of changes,
ask about that gap or offer completion; never guess original bytes. Prepare
`context task rollback --input <file|-> --format json` using:

```yaml
summary: Restore the selected page and discard unfinished follow-up drafts; keep other work.
discard_unfinished: true
files:
  - path: knowledge/guides/selected-page.md
    base_digest: sha256:<current-file-digest>
    content: |
      <exact recoverable original Markdown, not a newly generated replacement>
```

`files` contains only the explicitly selected reversions. `content: null` removes
an explicitly selected file that this task added; `base_digest: null` is for
restoring an absent file. Include changed sources/configuration/processed scopes
when they belong to the rollback. Leave unrelated and pre-existing edits alone.
An empty list only discards unfinished work and must not be described as undoing
already delivered pages. The preview shows actual before/after contents and
draft loss. Once the user approves that exact scope, run the preview's apply
command with its plan digest. Then follow the rollback Route through close,
build and cleanup. A failed build retries delivery, not the already-applied
reversions. Begin the independent task only after cleanup succeeds.

A managed source can be explicitly renamed with `context source rename
"<note:... or sessions:...>" --name "YYYYMMDD/new-name.md" --format json` after
its active work is finished. Review the file/reference changes, then apply the
returned digest-bound command. Existing references move with it; the original
body is not copied into another source type. Follow status to refresh affected
knowledge structure and packages.

To move an approved page, use `context revise "<old path>" --move-to "<new path>"
--instruction "<requested move and content changes>" --format json`. The new
path stays in the same collection. The revision retains the page identity,
rebases outgoing links and updates incoming Markdown links at approval. A new
subject name alone only needs a title/content revision; do not create duplicate
pages. Retirement is a content decision: explain the inapplicable material and
supported replacement before changing its page and referring navigation.

### Adjust inputs while a local update is unfinished

`context task adjust --input <file> --format json` also applies to an active
approved-page revision or source-update queue. Keep `scopes` and `instruction`
explicit. First call without `refresh`; it authorizes replacing only those
inputs and blocks page completion while acquisition is pending. Import the
selected new material, then repeat with `refresh: true` to bind the actual local
versions and obtain the new Route. Do not submit the old revision. Current
prose and queued pages remain; an affected draft returns to writing/review.
An unrelated queued page does not revoke an unchanged current page's review.
If a page has already been applied, finish its close/build before changing its
inputs. Only the final completed scope advances its processed baseline.

For several documents, `source import` also accepts a JSON/YAML array of the same
single-document inputs. Its receipt reports each zero-based input index and
success or error separately; a partial batch returns a nonzero exit code.
Keep successful sources and retry only failed entries. It does not fetch a
successful prefetched document again or roll back an unrelated saved note.

To add a new supporting source to an unfinished local revision, first save it
and include it in the current requirement's evidence scope and the selected
Indexer's read scope. Its `task adjust` scope also supplies the explicit
`requirement_ref`. This extends the current page's available sources and keeps
queued pages; it does not silently start another task or another Indexer.
