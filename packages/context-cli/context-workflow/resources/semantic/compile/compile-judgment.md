---
context_resource: semantic/compile/compile-judgment
id: context.semantic.compile.compile-judgment
kind: procedure
media-type: text/markdown
applies-to:
  - support
  - weak_evidence
  - duplicate
  - conflict
name: compile-judgment
description: >
  Internal support/relation judgment procedure for the current compile and
  review gates; not a user slash command. Consumes current compile/review
  diagnostics and evidence views, judges each draft action's source evidence
  support and relation to listed candidates, and returns a judgment the caller
  expresses through current compile actions, unresolved structure, or an
  explicit user question.
tools:
  - Bash
---

# compile-judgment — judge compile support and relation

Decide whether each proposed compile action is supported by cited source
evidence and how it relates to candidate Sections listed by the CLI. Return the
judgment in the current route; the CLI reviews, applies, and writes every
workspace change.

## TL;DR — Non-negotiables

- Invoke this procedure only when current align/compile/review diagnostics ask
  for support, duplicate, conflict, replacement, or weak-evidence judgment.
- Input is the budget-safe diagnostic or view returned by the current phase.
  If the view is paginated, follow `next_command` until every relevant item is
  listed.
- The summary is an index: use only CLI-returned detail commands when full
  proposed content, source evidence, or source_ref details are needed.
- Do not inspect `sources/`, `knowledge/`, `dist/`, or
  `.tmp/context-runtime/lifecycle/` directly
  or run ad-hoc scripts to reconstruct candidates. Use only the current
  diagnostics, evidence views, candidate lists, and detail commands returned by
  the CLI.
- Output the judgment in the caller's current shape: repair compile actions,
  update unresolved structure items, or ask the user. Do not emit a standalone
  judge-decision payload unless the current CLI schema view explicitly asks for
  one.
- Keep one decision per diagnostic item, preserving CLI order.
- Compare only the candidates listed on that item. Do not perform workspace-wide BM25, grep, or source-file searches.
- Inspect every candidate page the CLI provides before judging. If candidates
  are paged, follow `next_command` until no candidate page remains.
- When there are no candidates, classify the action as new unless the evidence
  itself is unsupported or structurally misplaced.
- For duplicate, replacement, conflict, or update judgments, name the matched
  candidate Section in prose or repair rationale only when the current CLI view
  exposes that Section id.
- Same `source_ref` can support different Section kinds only when the semantic role differs. Detect and explain same-source-ref multi-kind cases instead of treating them as automatic duplicates.
- Raw/source_ref diagnostics are deterministic evidence checks, not a keyword gate. A supported judge verdict comes from the cited raw evidence semantically covering the claim.
- Evidence-boundary errors remain blocking evidence issues. Section kind precision, example formatting, and summary style are advisory unless the active CLI `next_action` explicitly blocks on them.
- Weak support is a warning-level verdict, not permission to invent missing facts. Unsupported support should normally pair with `conflict` or a later user question rather than a write decision.
- Weak support, replacement, or conflict that depends on business meaning must
  route to explicit user confirmation. A blanket "continue" is not enough; ask
  the concrete choice and express the answer through the current compile,
  structure, or review route.

<reference>

## Judgment Shape

Use these values as the decision vocabulary in your repair note or user
question. The current write payload is still `context.structure.v1` or
`context.compile-actions.v1`, not this table.

## Verdict Meanings

| Judgment | Meaning |
|---|---|
| `supported` | Cited source evidence covers the claim. |
| `weak` | The evidence plausibly supports an ordinary summary, but review may ask for confirmation. |
| `unsupported` | The claim adds facts or boundaries not present in cited source evidence. |
| `new` | No listed candidate already covers the proposed knowledge. |
| `duplicate` | A listed candidate already covers the same claim. |
| `replacement` | A listed candidate is stale or wrong and should be replaced by the new claim. |
| `conflict` | The prepared claim and candidate disagree and need user resolution. |
| `update` | The prepared claim should refine one listed candidate. |
| `merge` | The proposed claim should be folded into one listed candidate without changing meaning, when the current schema exposes a safe update path. |

</reference>

<procedures>

### Step 1 — Load Current Diagnostics And Candidate Details

Use the caller-provided compact diagnostic output. For every item with
candidates, load only the CLI-provided candidate detail view before judging
relation. Do not infer missing candidates from memory or bypass the detail view.

### Step 2 — Judge Support

For each item, read the proposed content and cited evidence. Use source_ref
diagnostics only as evidence pointers; final support is your
semantic verdict from the cited raw evidence.

### Step 3 — Judge Relation

Compare the proposed claim against each listed candidate. Track every visible
candidate in your reasoning, and continue candidate pages until the CLI says the
candidate list is complete. If the candidate list is empty, classify the action
as `new` unless support or structure checks fail.

Use this relation/action chain before returning a repair:

| Relation judgment | Current route |
|---|---|
| Exact same claim already active | Do not write a duplicate section; emit or repair a `skip` with duplicate reason when the schema supports it. |
| Same claim with source-backed wording/detail refinement | Use `update` only when node-context and schema expose the target section; otherwise ask the user or return to review/structure. |
| Related but orthogonal claim | Keep a separate action/section when the planned section owns the cited source refs. |
| New evidence replaces a previous rule, value, or decision | Treat as replacement; ask the user or return to review/structure. Do not hide the replacement inside a same-section edit. |
| Direct contradiction | Ask the user. Do not auto-resolve from source order, title order, or "latest-looking" wording. |
| Candidate relation depends on another node or edge | Return to prose align so the typed edge or unresolved item can be confirmed. |

For duplicate, replacement, conflict, merge, or update judgments, name the
candidate section(s) inspected in the repair rationale when the CLI exposes
their ids. Do not claim workspace-wide uniqueness unless the current CLI view
performed that search.

### Step 4 — Emit Judge Decisions

Return only the judgment needed by the caller: repaired current payload,
unresolved item, or user question. Do not invent a separate semantic repair command
unless the current CLI explicitly returns one.

</procedures>
