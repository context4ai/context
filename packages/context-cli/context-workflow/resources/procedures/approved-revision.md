---
id: procedure.approved-revision
kind: procedure
mediaType: text/markdown
---

# Revise an approved page

The current action contains the approved page and the user's instruction. Read
the entire page first. Revise only what the instruction and available sources
support; retain still-correct explanations and confirmed user contributions.

For an expression-only change, the approved text is enough. Do not capture,
parse, partition, or reconfigure its source. For changed facts, read the relevant
registered material with the available host tools. Missing evidence is a reason
to ask about the affected claim, not to reconstruct the whole knowledge base.
Record new factual contributions as managed sources before expanding source
ownership; an editing instruction alone is not a permanent factual source.

If a source diagnostic blocks the action, inspect that exact source before
calling it uncaptured. An invalid retained capture report is not evidence that
the source was never collected. Do not use rollback, task preparation, or source
removal to repair a revision-token or submission-schema error. Refresh the
current action and use its revision and required `stage: approved-revision`.
If the fresh action still conflicts, preserve the request and report the tool
blocker instead of repeatedly clearing or re-registering maintenance.

For new independent evidence added during a revision, keep its own managed source.
A `requirement_ref` alone does not authorize it: the selected requirement in
`src/indexers.yaml` must connect the new source to an existing task source through
its target or evidence scopes. When `revision-source-scope-unconfirmed` is returned,
use its `missing` and `configuration` fields to correct only the user-authorized
association. Then retry the same `task adjust` without refresh. If it returns
`adjusted` (the material was already local), continue; otherwise, once material
is available, repeat with `refresh: true`. Reread the resulting revision. Do not invent
module references, replace an older note, delete sources or clear the task to
satisfy this boundary. Already imported material does not need to be imported again.
The adjusted source stays citable by the remaining pages queued in the same revision;
repeating the adjustment for an unchanged source keeps already prepared pages.
A managed-source `base_digest` protects file replacement from conflicts; it is not
source-scope authorization and is not interchangeable with a snapshot hash.

Return the full revised Markdown in the supplied output schema, preserving the
page's stable fragment markers and metadata. Do not silently
turn paraphrased text into a verbatim quotation. Do not directly write knowledge
files. Context prepares a Candidate and routes it through the existing Review,
apply, close, and build steps. Managed mode delegates Review, not source truth.

If Context reports that the approved page changed, read that version and restart
the revision. Never overwrite a concurrent edit with the old page snapshot.

When `target.base_digest` is null, this is a new page in the confirmed update scope.
The supplied Markdown contains its initial metadata. Article identity stays in the structure.
Read the specified source material and write the complete page with source-bound
sections, using the existing purpose and page forms. Do not treat the initial
heading as an already written page.

Use `target.source_refs` as the allowed source scope, not as a list to copy onto the page. It can include explicitly
selected supporting material absent from the old Markdown. Read that material
before using it, add only its relevant explanation, and cite it in the affected
sections. A session rationale is not proof of runtime behavior.

When `target.previous_path` is present, the user explicitly selected a page move.
Keep its stable article identity and fragment IDs. The supplied Markdown already rebases its
relative links for `target.path`; do not put them back at the old location.
Explain the move in the review summary. Approval moves the page and updates
incoming Markdown navigation together; do not create a second copy or manually
delete the old file. A changed destination or original page requires a fresh
revision, not an overwrite.

For selected `note` inputs, read [note guidance](note.md). For `sessions`,
read [sessions guidance](sessions.md). Read only the applicable source guide.


Read `writing_context` for the confirmed reader requirements, current sections,
authorized source entries and any available skill guidance from this temporary
work session. A missing skill selection does not invalidate the approved page
or require restoring a former Provider registration. These inputs apply to
direct page corrections too.
Preserve the current page form; choose a different form only for an explicit
change of purpose. Do not replace API tables with generic explanatory prose.
The current sections are approved content, not freshly extracted API facts.
Ordinary source updates do not automatically parse the repository or generate
API tables. Read the changed material relevant to the requested correction;
use a suitable scoped analysis capability when needed. Do not wait for a
Provider selection, version check or program block before revising ordinary
prose. Keep actual source citations and the current revision baseline.

When an explicit regeneration request supplies `program_blocks`, they contain
API tables computed from scoped Parser facts with the deterministic renderer. Select only the
relevant blocks and place their exact `token` inside the corresponding sourced
section. The CLI expands it at submission; do not retype its rows. Do not use an
unrelated declaration merely because it shares a module. If a needed block is
absent, report the missing material rather than present an old table as fresh.

Compare the relevant generated rows with the requested correction before
submitting. If the source is available but its type or expression cannot be
resolved, state that specific limit instead of requesting the same files again
or guessing a value. If a supplied block contradicts a confirmed fact, report the
field and source location; do not rewrite the token's table by hand. The final
Candidate still needs Review: a token or accepted submission does not establish
that the requested correction reached the page.

A revision that processes a source version (the source update's pages) must
resolve the page's citations of that source that no longer match it, including
those in paragraphs you do not rewrite: preview and submission list each one with
its paragraph and lines. Rewrite the paragraph, cite the current text, or remove
the citation. Stale citations of other sources are kept and returned as
`reference_warnings` for a later update or revision.

Context collects complete pages into a delivery batch. An Author completion can
therefore lead to another Author before Review. Follow that Route; do not close
or build after each page. Review, close and build operate on the assembled batch.
A new topic reaches this action only after its affected structure is approved.

After a Review rejection, the current Author action contains the rejected draft
and its original task. Apply the user's feedback, or ask what should change if
it is unclear; do not resubmit the same rejected proposal without addressing the
decision. Other approved pages remain approved. Revisiting an earlier batch page
also retains the interrupted Author in the same task queue, so follow the next
Route instead of restarting the update.

For note/sessions contributions, `writing_context.sources` supplies the exact
saved-source paths and optional known change associations. Read the relevant
summary before revising. A source change reference does not authorize an external
fetch or prove upstream adoption. Keep the existing knowledge header minimal;
page/section source relationships belong in structure.yaml.

When the Route selects merge recovery, approved content changed during revision.
Read its latest target and merge_context, retain the concurrent edits and any
still-applicable draft changes, and submit the merged Markdown with the returned
revision. Ask the user if the changes conflict in meaning; a deleted page is not
permission to recreate it. The CLI checks the new baseline again and sends the
result through ordinary Review. Unaffected batch pages and queued operations stay
in place. Do not retry an older revision or overwrite the approved file directly.

## Local section edits and optional preview

For a small change, submit `sections` instead of `markdown`. Select exact IDs from
`writing_context.current_sections`; each edit contains `section_id` and `content`,
an ordered array of `{ "markdown": "replacement text" }` or
`{ "program": "exact token from program_blocks" }`. The CLI retains untouched
sections and page identity. Omitted references preserve the previous citations. Do not include
section wrappers in replacement text. Use full Markdown for new pages, changed
structure or pages without unambiguous section IDs. Both forms use the current
Action schema and the same source and baseline validation.

When a fragment's support changes, include `references` with its actual
`source_ref` and `locator` (`path`, `start_line`, `end_line`). Each fragment allows
regions from up to five source files, eight regions in total; Context reads the captured region and computes its digest.
For full Markdown, optional `sections` contains only `{ section_id, references }`
entries; for local edits it can accompany `content` or update references alone.
An explicit empty list removes that fragment's citations. Deleted fragments lose
their references; new fragments need their own selected sources, not copied IDs.
Uniquely moved unchanged text can retain its fingerprint at its new position;
changed or ambiguous regions remain visible for review, not silently refreshed.
Inside a submitted `references` list, an earlier citation repeated with the same
`start_line`/`end_line` means "keep that evidence": Context moves it to where that
text is now, or rejects the fragment when it no longer exists uniquely. To cite
the text now at those lines instead, use a `quote` or `heading` locator; those
always select current text.

For example, after substituting IDs/tokens from this Route:

```json
{"stage":"approved-revision","sections":[{"section_id":"usage","content":[{"markdown":"Revised explanation."},{"program":"<current program token>"}]}]}
```

Use `--input <file>` on the Route command. If useful, append `--preview` to that
same command: it returns the assembled Markdown and prior text without accepting
or advancing the revision. Submit without `--preview` after checking it. Preview
is optional; it does not replace Review or authorize a stale revision.

For a prepared multi-page batch (`prepare-current`), append `--preview` to the
batch submission. It applies the submission checks to every page against its
issued input (task binding, fragment file and region limits, line ranges in the
fixed source, signing) against the current Route and returns one result per page
with its issues, without saving drafts, task state or source caches. It reports problems and never repairs them: for example, a line range
past the end of a file is reported, not clamped. Write the whole batch, preview
it once, correct the flagged pages, then submit; do not write ad-hoc validation
or re-signing scripts.

Preview is useful only when its assembled text will be read before deciding to
submit. An unattended loop submits directly. Continue from the receipt's
`next_route.inline`, or read `next_route.file` once; do not routinely run status
or preview between submissions. Stop a loop when the Route node changes, a new
required reading appears, or a human gate is reached. Bind prepared content to
the issued task inputs rather than attaching an old draft to a fresh revision.
If submission fails, use its returned submission state and recovery action;
never replay work already committed. Refresh status when the next Route is
missing or the workspace changes externally.

## Interpreting generated API output

Check fields, types, requiredness and supported defaults against the selected
source version. A table can completely express a simple declaration; omitting
that duplicate folded declaration is intentional. Complex relationships or
constraints not represented in rows remain in a named declaration. Program
`declaration_status`, when present, distinguishes `table-complete`,
`component-wrapper`, `retained` and `not-provided`; its `fact_ref` and `source_ref`
locate the input. Missing folds alone do not establish a parser failure.

If the user explicitly requires a different presentation, explain the difference
and resolve that choice before accepting it. Do not rerun unchanged Repair to
force a format the program deliberately omits. Check the actual resulting page;
accepted tasks or an empty Composer result alone do not demonstrate a correction.

### Locating submitted references

Submission locators also accept `{path, heading}` or `{path, quote}` instead of
line numbers. Use exactly one form. A heading is the title text of an exact ATX heading
outside code fences in a Markdown source; a leading `##` marker is optional and,
when present, also selects the heading level; its region ends before the next
same-level or higher-level heading. A quote is an exact, unique, nonempty
substring (line endings are normalized). Ambiguous matches return candidate
line ranges. Both forms resolve against authorized captured text before hashing;
stored references still contain only `path`, `start_line` and `end_line`.
The per-fragment limits (five source files, eight regions) apply after
resolving and deduplicating positions.

## Submitting several prewritten pages

Single-page submission remains the default. When several queued pages are already
written, use the optional `action prepare-current` command from this Route. It
returns the existing `tasks[]` submission shape, task input files and one temporary
Agent directory. Compare each draft with its issued instruction, source inputs and
current sections before submitting it. An `edits` file contains the same
`stage: approved-revision` payload as a single submission; alternatively, `content`
is full Markdown and `references` is `{ "sections": [...] }`. All result paths are
relative to the returned Agent directory.

Submit an ordered completed prefix. The CLI saves one page at a time and stops at
Review, changed inputs, new reading requirements or a failed page. Follow the
returned Route. If a page fails, correct it and submit only the unfinished suffix
with the current Route revision and original input tokens. If inputs changed,
prepare again and reconcile the drafts. Never resubmit a committed page; uncertain
transactions must use the returned recovery action first.

For long submission loops, report completed/total progress using temporary files.
Use the host's recoverable background execution when available, otherwise allow
sufficient foreground timeout. Wait for the running command rather than repeatedly
polling through model turns. Do not modify knowledge inputs during a write.
