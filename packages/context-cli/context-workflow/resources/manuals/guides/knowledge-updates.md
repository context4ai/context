---
id: context.sdk.knowledge-updates
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

## First-task intake budget

Before registration and capture, the Agent uses the user's task instructions and
reads batch metadata titles across the explicitly supplied document list. Lark
metadata requests accept at most 200 entries each, not 200 words or 200 documents
overall. H1/H2 may be reused only when metadata returns them without
body retrieval; Lark batch metadata returns titles, not headings. Batch failure
falls back to at most 10 unresolved document title lookups total, unless a shared
authentication failure makes those calls redundant. The Agent does not fetch
source bodies, outlines, images or attachments. Missing title metadata is
optional: preserve the original URL without falling back to body retrieval or
changing credentials. Resolve intent from the conversation; refine provisional
chapters and module boundaries from evidence after formal capture.

## Workspace versions and changelog

`package.json.version` is the workspace SemVer. At completed-scope delivery the
workflow asks the Agent to inspect formal changes and record an increasing version
with a concise changelog. Added modules or expanded material coverage increment
minor; corrections, existing-module updates, navigation and persistent status
changes increment patch. Major requires an explicit user instruction. Temporary
progress under `.tmp/` never causes a version increase.

Version recording runs at completed-scope delivery after Review, Close and package
configuration/template approval, before the final build. The record response
returns the next workspace Route, so no extra status call is needed. Build retries
reuse the recorded version when formal content is unchanged. Intermediate batches
do not each receive a version.

The workspace AGENTS.md and version-writing instructions require each entry's
details to stay within 1500 visible characters, including punctuation across the
title, changes, trigger descriptions and actor display name, excluding protocol
keys, version and date. The Agent compresses longer drafts before submission,
preserving main changes, impact and triggers instead of truncating text or splitting
the iteration into extra versions. This is an Agent writing rule, not a prose-quality
CLI gate.

`context version inspect --format json` returns changed paths and a digest. The
coordinator submits `context version record --input <file> --format json` with:

```yaml
expected_digest: "<digest returned by inspect>"
version: 0.2.0
title: Add module recovery guidance
changes:
  - Document recovery conditions and the supported retry flow.
triggers:
  - kind: module
    description: Additional module material requested in this iteration.
actor:
  kind: lark
  name: Example User
```

`actor` is optional; omit it to use local Git `user.name` when configured. Use a
Lark display name only when explicitly known from the conversation. Trigger kinds
are `initial`, `note`, `sessions`, `mr`, `module`, `document`, `navigation`,
`repair`, `dist`, and `other`. Agent-written fields describe the actual diff and
conversation; they must not expose credentials, raw transcripts or private IDs.

The CLI writes `changelog.yaml`, generated `CHANGELOG.md`, `package.json` and the
`.context-version.json` content baseline together. Keep these formal files with
the workspace; do not hand-edit generated baselines. Git-managed and unignored
new files are compared (without Git, non-runtime workspace files are compared).
Version metadata itself, `dist`, `.tmp` and dependencies do not cause changes.

Successful builds record version and per-package hashes in `.context-builds.json`.
They do not increase versions. Before publishing, `context version publish-check
--format json` compares against `.context-published.json`. A same-version changed
output requires a patch using `version inspect --publish` and a `dist` trigger,
then a rebuild. Record `version published --hash <checked-hash> --receipt
<successful-publication-reference> --format json` only after external success.
No command commits, tags or uploads automatically.

Website history is available at `changelog.html`: cards are newest first, the
latest three expanded and older cards collapsed. The History button beside the
theme switch and footer update timestamps link there. KB and LLMS outputs carry
the same workspace version and changelog.

## Customize the knowledge map at any time

For a knowledge-map-only change, use the existing `context task adjust
--input <file|-> --format json` action with `knowledge_map`. Supply its
current `expected_revision`, explicit `upsert` entries and `remove` keys. Each
entry retains its stable key, parent, title and order; optional targets use
article identity and section key. The current structure preview supplies those
identities. Read the persistent `src/knowledge-map.yaml`; use
`expected_revision: null` only when no knowledge map exists.
After adjustment, follow status to rebuild affected packages. This changes the
reading organization without capturing sources or rewriting approved prose.
Do not directly edit generated package navigation or use titles as identities.

Users can ask in conversation to move a topic, rename a directory, change order,
or organize the same articles for another reader task. Handle this during ongoing
production or after completion through the same adjustment; no active Indexer
task, source recapture or new mode choice is required. Finish or revoke active
worker assignments before changing the map. Preserve unrelated entries and page
identities. The map controls website navigation and LLMS organization together.

For each new or changed article, the Agent decides whether to retain its current
placement, add another placement, move it, or create a warranted category. Check
these choices against the user's settled organization before structure approval
and delivery. New articles must be bound even if the map revision has not changed;
modifying a title alone is not a reason to change article identity. Never satisfy
coverage by mechanically placing every new page under an unrelated catch-all.
Build reports missing bindings for the Agent to resolve; it does not classify
content. Moving a menu entry does not change the article URL.

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

### Replacing supporting article identities

When an upstream article is split, merged or removed, start `context revise` for
its consumer and use `context task adjust --input - --format json` with
`instruction` and `knowledge_dependencies: { dependencies }`. Each dependency
uses an approved `artifact_ref`, optional `section_refs`, and `required` flag.
The current Author input returns authorized replacement facts and their evidence.
Repeat the adjustment with `knowledge_dependencies.sections`, selecting each
retained `section_key` and its full `fact_refs` and `evidence_refs` support. Then
revise the explanation and complete normal Review, close and build. An explicit
empty dependency list removes the relationship only when remaining sections have
valid direct support. Missing dependencies, changed approvals and invalid source
references cannot silently become current evidence. Writing quality remains an
Agent/Review decision; no chapter-count or wording gate is introduced.
