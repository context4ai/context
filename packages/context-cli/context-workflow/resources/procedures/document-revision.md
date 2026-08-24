---
id: procedure.document-revision
kind: procedure
mediaType: text/markdown
---

# Conversational document correction

Use this procedure only for a correction explicitly requested by the user after
an approved knowledge page already exists. The request selects one page; it
does not authorize a broad rewrite or a change to source facts.

1. Run the Route command `context optimize-docs revise-current --format json`.
2. Read the complete approved page and its sibling `__revision.md` page named
   by the returned plan. Check the cited source when the requested correction
   could change a fact rather than formatting or wording.
3. Edit only the returned revision page. Preserve its frontmatter identity,
   `context_revision` baseline, Context section boundaries, evidence markers,
   links, code, numbers, and unsupported details. Make the smallest change that
   satisfies the user's request. Never edit the approved base page for this
   operation.
4. Run `context optimize-docs validate --format json`. If validation reports a
   stale baseline, unsafe replacement, or missing evidence, stop and report the
   exact finding instead of weakening the correction.
5. Continue from the returned `context status --format json` Route. A valid
   correction makes the package stale, so the normal build Route will offer
   compilation without requiring a second correction decision.

If the entry returned more than one target candidate, select a candidate only
when the user's wording or current conversation identifies it uniquely;
otherwise ask the user which approved page to correct. Do not guess.
