---
id: procedure.source-update
kind: procedure
mediaType: text/markdown
---

# Check source changes against current knowledge

Read the fixed source versions and confirmed requirement scopes in the action.
Use the host's existing repository or document tools to inspect the change and
relevant current material. A missing previous version means unknown history;
inspect the confirmed scope without pretending the latest acquisition was
already incorporated into knowledge. Do not fetch material already acquired.

The listed pages are candidates to inspect, not an instruction to rewrite all
of them. Read their current approved Markdown. Submit one decision per path:
omit `instruction` if no correction is needed, or describe the concrete change
to make. Preserve unrelated content and the reader's existing improvements.
Include a short `scope_summary` explaining the scope-level conclusion.
When the action lists `changed_references`, start from those sections: the
cited block was not found (`not-found`), has multiple matches (`ambiguous`), or
cannot be checked from the available snapshot (`unavailable`). A transient read
failure is a failed observation, not a reason to revise an article. For explicit
updates and `context update --pending`, pages whose citations
are unchanged or only moved are not candidates, so an empty list is possible;
still check the change for additions before submitting the scope decision.
Those pages are listed in `scope_pages`: they need no decision, but include one
with an `instruction` when an addition or shared change affects it.

Follow each changed reference's `evidence_ref` into the JSON array in
`reference_evidence_file` (`reference_evidence_count` entries) for
digest-verified historical text and the current excerpt. Read only the entries
for references you are deciding; the Route does not repeat them inline. Missing history is
explicitly marked unavailable. The current excerpt is from the old position
or nearby lines, not a claimed replacement; only a `format_only_proposals`
entry supplies a mapped replacement for your decision.

When `format_only_proposals` is present, compare every proposed old/new region.
Only if the document's changes preserve meaning, keep the affected page bodies
and submit `format_only: [{source_ref: "<proposed source>", reason: "<why the changes are only formatting>"}]`.
Keep those pages in `decisions` without an instruction. The CLI supplies and
validates new locations; do not guess line numbers. Removed strikethrough, changed
link targets or a restored table may change meaning even if the text looks similar.
If any mapping is missing or uncertain, use normal revision. A format-only
decision does not authorize publication or suppress unrelated version changes.

Also inspect additions and shared dependencies in the source change. Existing
page references cannot discover every new topic. List necessary new pages in `new_topics`, each with a readable `path` in an existing
collection, `title`, registered `source_refs` and an `instruction` describing the
reader task and material to use. Reuse the established purpose and page forms.
Use an empty list only when existing pages cover the change or the additions
are outside the confirmed purpose. New pages go through the same writing and
review process as revisions; a new topic is not a no-change decision.

A kept page's citations whose text only moved in the updated source are
relocated when the update settles. When cited text changed or cannot be
confirmed, the completion result lists it in `reference_warnings`; those
citations keep their previous locations. Listed `repo-content:` citations are
still re-signed to the current repository text, so `verify` will not report
them later; check those pages from the receipt. The warning is a receipt for the
accepted decision, not a request to resubmit it: after the current update queue
finishes, run `context revise` on each listed page that needs a correction.

The CLI keeps the previous processed version until every requested page has
been approved, closed and built. If temporary progress is lost, inspect again
from that version and preserve the pages already approved. A saved report or
acquisition receipt does not prove that the knowledge update was completed.

If a revision needs a newly supplied note or development summary, include its
exact `supporting_sources` on that page decision. These must already belong to
the confirmed evidence scope. Do not attach redundant summaries or turn an
auxiliary source into an independent production target. Code unchanged plus
new explanation still needs an impact decision; it does not require another
Parser run.

A renamed subject does not automatically need a new page identity. Revise its
title and explanation in place unless the user chooses a different path; an
explicit path move uses `context revise --move-to` after the current page work
is closed. For retirement, explain what disappeared or became inapplicable,
which readers are affected and any supported replacement. Do not silently
delete same-source pages. Include referring pages that need navigation or
wording changes in this update's decisions.

For selected `note` inputs, read [note guidance](note.md). For `sessions`,
read [sessions guidance](sessions.md). Read only the applicable source guide.
