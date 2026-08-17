---
id: context.semantic.compile.compile-notes
kind: procedure
media-type: text/markdown
applies-to:
  - notes
  - updates
  - skip
  - source_refs
---

# Note snippets
<!-- Context workflow semantic resource. -->

Consult this reference only when the current CLI exposes note evidence in a
source-bound phase view. Note evidence carries conversation material
(revisions, decisions, brainstorms) rather than primary source documents.

## TL;DR

Note snippets are **prioritization hints, not write authority**. `note_intent`, `anchored_to[]`, and `revision_kind` may suggest update / replacement / complement / skip, but they never authorize a write without semantic review.

## How to route a note snippet

When a source evidence entry has `source_type: "note"`:

1. **Compare against the anchor first.** If `anchored_to[]` names this Node or one of its Sections, treat that target as the candidate for `update` / replacement review / `add` (as a complement) / `skip`. **Do not create a new Node** from the note title here — that is an align-time concern.

2. **Use `note_intent` and `revision_kind` to bias the action**:

   | `note_intent` | typical action |
   |---|---|
   | `revision` | `update` when meaning stays the same; otherwise replacement review against the anchored Section |
   | `decision` | `add` a `decision` Section when no equivalent exists; otherwise `update` |
   | `brainstorm` | usually `skip` unless the brainstorm explicitly confirms a fact the Node should record |

   `revision_kind` (`replace` / `clarify` / ...) refines the choice within `revision`.

3. **No-write reviewed-no-write case.** If the note says "don't modify active
   knowledge yet" or the correct outcome is no-write after review, emit `skip`
   with the note's current `source_refs[]` when the CLI exposes them. This lets
   semantic review record `reviewed_no_write` instead of treating the skip as an
   unreviewed no-op.

4. **Bare skip is not allowed for notes.** A bare `skip` (no evidence) is only
   for deterministic no-op cases such as unchanged input or pure navigation.
   Notes always carry an anchor and an intent; the skip must cite the note's
   explicit source ref when the current CLI exposes one.

## Where this lives in the main procedure

- **Step 2 — Classify**: run the note-first comparison **before** the generic kind priority chain. If the note resolves to `update` / replacement review / `skip` (reviewed), record the current action or user/structure route and move on; do not also process the same note through the generic chain.
- **Step 5 — Self-verify**: every note snippet was either consumed by an
  anchored action or carried into a `skip` with `source_refs[]` when the current
  CLI exposes citeable refs.

Notes never become compile challenge actions on their own. If a note describes a
structural problem (missing Action, wrong parent, etc.), capture or cite the
underlying source evidence and return to the structure gate described in
`references/structural-challenges.md`.
