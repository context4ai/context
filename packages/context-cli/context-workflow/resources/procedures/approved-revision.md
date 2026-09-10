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

Return the full revised Markdown in the supplied output schema, preserving the
page's identity, source list, and source-bound section markup. Do not silently
turn paraphrased text into a verbatim quotation. Do not directly write knowledge
files. Context prepares a Candidate and routes it through the existing Review,
apply, close, and build steps. Managed mode delegates Review, not source truth.

If Context reports that the approved page changed, read that version and restart
the revision. Never overwrite a concurrent edit with the old page snapshot.

When `target.base_digest` is null, this is a new page in the confirmed update scope.
The supplied Markdown contains only its stable identity and initial metadata.
Read the specified source material and write the complete page with source-bound
sections, using the existing purpose and page forms. Do not treat the initial
heading as an already written page.

Use `target.source_refs` as the final page source list. It can include explicitly
selected supporting material absent from the old Markdown. Read that material
before using it, add only its relevant explanation, and cite it in the affected
sections. A session rationale is not proof of runtime behavior.

When `target.previous_path` is present, the user explicitly selected a page move.
Keep its stable Node/View identity. The supplied Markdown already rebases its
relative links for `target.path`; do not put them back at the old location.
Explain the move in the review summary. Approval moves the page and updates
incoming Markdown navigation together; do not create a second copy or manually
delete the old file. A changed destination or original page requires a fresh
revision, not an overwrite.

For selected `note` inputs, read [note guidance](note.md). For `sessions`,
read [sessions guidance](sessions.md). Read only the applicable source guide.


Read `writing_context` for the selected Provider, reader profile, current sections
and actual template resources. These apply to direct page corrections too.
Preserve the current page form; choose a different form only for an explicit
change of purpose. Do not replace API tables with generic explanatory prose.
The current sections are approved content, not freshly extracted API facts.
For source updates or an explicit regeneration request, `program_blocks` contains API tables computed from current
scoped Parser facts with the ordinary deterministic renderer. Select only the
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
sections, page identity and the edited section's source references. Do not include
section wrappers in replacement text. Use full Markdown for new pages, changed
structure or pages without unambiguous section IDs. Both forms use the current
Action schema and the same source and baseline validation.

For example, after substituting IDs/tokens from this Route:

```json
{"stage":"approved-revision","sections":[{"section_id":"usage","content":[{"markdown":"Revised explanation."},{"program":"<current program token>"}]}]}
```

Use `--input <file>` on the Route command. If useful, append `--preview` to that
same command: it returns the assembled Markdown and prior text without accepting
or advancing the revision. Submit without `--preview` after checking it. Preview
is optional; it does not replace Review or authorize a stale revision.

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

## Changed supporting articles

`knowledge_input` separates approved interpretation from source-bound facts.
Recheck the relevant interpretation when an upstream article changes; ordinary
revision refreshes its version only after Review. Waiting input does not make
old statements current, and a wording-only edit must retain the review warning.

For a split, merge or removed upstream, use the existing `context task adjust
--input - --format json` with `instruction` and `knowledge_dependencies`:

```json
{"instruction":"Rebind the affected explanation to the approved replacement","knowledge_dependencies":{"dependencies":[{"artifact_ref":"<approved article identity>","section_refs":[],"required":true}]}}
```

Select identities from the authorized approved article catalog; do not guess
paths or promote prose into parser facts. Read the new current Route's
`knowledge_input`, then repeat the adjustment with the same dependencies plus
`sections`: each item has the retained `section_key`, selected `fact_refs` and
`evidence_refs`. These are a full support replacement for those sections, not an
append. Use only the supplied replacement facts or still-valid direct facts.
An empty dependency list explicitly removes the old relationship; the remaining
explanation still needs valid direct evidence. Revise the text to match the
selection before submitting. The CLI checks identity, scope and version; the
Agent and Review judge the explanation. Pending upstream approval remains a
concrete task to finish or adjust, not a reason to clear the warning manually.
