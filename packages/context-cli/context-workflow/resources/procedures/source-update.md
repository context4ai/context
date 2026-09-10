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

Also inspect additions and shared dependencies in the source change. Existing
page references cannot discover every new topic. List necessary new pages in `new_topics`, each with a readable `path` in an existing
collection, `title`, registered `source_refs` and an `instruction` describing the
reader task and material to use. Reuse the established purpose and page forms.
Use an empty list only when existing pages cover the change or the additions
are outside the confirmed purpose. New pages go through the same writing and
review process as revisions; a new topic is not a no-change decision.

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
