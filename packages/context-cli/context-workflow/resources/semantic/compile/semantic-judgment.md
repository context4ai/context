---
context_resource: semantic/compile/semantic-judgment
id: context.semantic.compile.semantic-judgment
kind: procedure
media-type: text/markdown
applies-to:
  - support
  - duplicate
  - conflict
  - scope_omit
  - user_confirmation
name: semantic-judgment
description: >
  Internal semantic repair procedure for the current source-bound compile and
  review gates; not a user slash command. It judges support, duplicate/conflict
  risk, scope fit, weak evidence, leakage, and user-confirmation needs, then
  maps the result back to current structure, compile, review, or user-question
  surfaces.
tools:
  - Bash
---

# semantic-judgment

Use this only when current compile validation, review diagnostics, or a review
page asks for semantic repair beyond ordinary section drafting. This procedure
does not define a separate write schema. The caller expresses the outcome
through one of the current surfaces:

- repair the `context.compile-actions.v1` payload;
- return to `context.structure.v1` and mark the issue in `unresolved[]`;
- ask the user a specific confirmation question;
- leave the item unwritten with a source-backed reason.

## TL;DR

- Read only current CLI diagnostics and evidence views. Do not inspect
  `sources/`, `knowledge/`, `dist/`, `.tmp/context-runtime/lifecycle/`, host tool results, or JSON
  stdout fragments with generic tools.
- Use this procedure for semantic support, duplicate/conflict, omit/scope,
  leakage/ownership, temporal-prior, and confirmation questions.
- Never invent facts to make a draft pass. If evidence is weak, either narrow the
  claim, cite better source refs, return to structure confirmation, or ask the
  user.
- User confirmation must answer the specific current question. General
  permission to continue is not confirmation.
- Approval/apply is owned by the review gate. This procedure never runs an apply
  command by itself.

## Reference Routing

| Situation | Reference |
|---|---|
| Current diagnostics report context-only or secondary ownership leakage | [leakage-and-ownership.md](leakage-and-ownership.md) |
| Current diagnostics include source-ref boundary, temporal-prior, long content, or summary preservation issues | [temporal-and-evidence.md](temporal-and-evidence.md) |
| You are considering not writing evidence that otherwise looks citation-eligible | [scope-review-and-omit.md](scope-review-and-omit.md) |
| You are classifying unsupported, stale, replacement, withdrawal, or "remove" outcomes | [disposition-semantics.md](disposition-semantics.md) |
| A weak-evidence or no-write decision needs explicit user confirmation | [user-confirmation.md](user-confirmation.md) |

<reference>

## Judgment Vocabulary

Use this vocabulary in your repair explanation, user question, or current payload
commentary. Do not emit it as a standalone schema unless the current CLI schema
explicitly asks for matching fields.

| Judgment | Meaning | Current route |
|---|---|---|
| `supported` | Cited source refs directly support the reader-facing claim. | Keep or repair the compile action. |
| `weak` | Evidence plausibly supports a compression or interpretation, but a human should confirm the business meaning. | Ask the user, narrow/split the evidence boundary, or return to align. Do not add `content` / `content_intent`. |
| `unsupported` | The claim adds facts, scope, terms, or conclusions absent from cited evidence. | Remove/narrow the action, cite stronger evidence, or return to structure. |
| `duplicate` | Another planned or approved section already covers the same claim. | Skip this action with a clear reason or update the existing section only if the schema supports it. |
| `separate` | The claim is distinct and source-backed. | Keep a separate action or planned section. |
| `conflict` | The current claim and existing/planned knowledge disagree. | Ask the user or return to structure; do not auto-resolve. |
| `structure_mismatch` | Evidence belongs under another node/section or needs a missing edge. | Return to prose align and revise confirmed structure. |

## Decision Routing

Semantic reconciliation is expressed only through the current compile/review
gate. Route each judgment to the current flow:

| Judgment shape | Current route |
|---|---|
| Exact same claim already active | Emit or repair a `skip` action with a duplicate reason. Do not write a second section. |
| Same claim with source-backed correction or refinement | Use `update` only when the current compile schema and node-context expose the target section; otherwise ask the user or return to structure/review instead of silently merging. |
| Additional but separate source-backed boundary | Keep a separate planned section/action when the confirmed structure owns the cited refs. |
| New evidence replaces a previous rule | Stop and ask the user which rule should remain, or return to structure/review. Do not emulate replacement with a compile `update`. |
| Direct contradiction | Ask the user. Do not auto-resolve, and do not rewrite approved knowledge from memory. |
| Evidence is close but not enough | Ask the user, choose a narrower mirrorable ref, split the planned section, or return to align. Weak support is not permission to add missing facts. |
| Useful but no-write / scope-wrong evidence | Run the Scope Review pass and require explicit user confirmation before treating citation-eligible evidence as no-write. |

Do not emit standalone action names from another surface. Preserve the reasoning,
then express the result through `context.compile-actions.v1`, `context.structure.v1`
`unresolved[]`, review confirmation, or a user question.

## Relation And Action Discipline

Use the full semantic support / duplicate / conflict / disposition decision
model, and map every outcome to a current route:

| Prepared relation | Current action discipline |
|---|---|
| Exact duplicate | Skip/no-write only when the schema supports a reviewed skip or the current route says the item is already covered. |
| Near duplicate / same claim with source-backed clarification | Prefer `update` only when the target section is exposed and the meaning does not change. |
| Complementary separate claim | Keep separate when the confirmed planned section owns the refs and the claim is source-backed. |
| Replacement / superseding claim | Stop for user or structure review. Current compile must not smuggle replacement through summarized body text or same-section update. |
| Conflict | Ask the user a concrete business question. Do not resolve from source order, status order, or agent preference. |
| Weak support | Ask for confirmation or mirror the source more directly; weak support never authorizes unsupported facts. |
| Wrong node / wrong edge / wrong ownership | Return to prose align and revise `context.structure.v1`. Do not patch body text to compensate for a bad structure. |
| Unsupported / source removed | Narrow or remove the proposed action. If approved knowledge disposition is needed, route to review/structure; compile does not physically remove approved content. |

Do not accept a "default" semantic decision unless the current CLI explicitly
states that the default is mechanically safe for the current item. A generic
"continue" from the user is not a semantic default and is not user
confirmation. Preserve candidate order and compare only candidates surfaced by
the current CLI view; do not run your own workspace-wide search.

## Evidence Boundary Gate

A compile action must cite only source refs owned by the planned section it
targets. If the proposed reader-facing claim cannot honestly be supported by
those refs:

1. Narrow the claim to what the refs support.
2. Use a CLI-provided broader or adjacent ref only when the whole range supports
   the final claim.
3. Split unrelated facts into separate actions.
4. Return to structure confirmation when the needed evidence belongs to another
   node, another planned section, or an unresolved relation.

Do not use titles, navigation lines, parent/child lists, or "related" hints as
the sole support for a substantive claim.

</reference>

<procedures>

### Step 1 — Consume Current Diagnostics

Start from the current compile validation result, review HTML, or review/apply
diagnostic. Identify:

- the node and planned section involved;
- the proposed action body, summary, kind, and source refs;
- listed candidate sections or approved sections, if the view provides them;
- whether the issue is support, duplicate/conflict, leakage, scope, or user
  confirmation.

If the current CLI provides detail or pagination commands, follow them before
judging. Do not discover extra candidates by searching files yourself.

### Step 2 — Judge Support

Compare the reader-facing claim against cited source evidence:

- Every sentence must be supported by at least one cited ref.
- Summary may compress, but it must not introduce a new fact.
- Summary must stay faithful to source terms, numbers, code literals, product
  names, and relationship direction.
- Compile actions do not carry reader-facing `content`. If the section body can
  mirror source text, omit `content` and let the CLI materialize it verbatim.
  If it cannot mirror one confirmed evidence boundary, split or return to align.

Classify as `supported`, `weak`, or `unsupported`, then repair using the route in
the vocabulary table.

### Step 3 — Judge Relation To Existing Or Planned Knowledge

Use only candidates surfaced by the current CLI view. Do not run workspace-wide
searches.

- Same claim already covered -> skip the duplicate action or update through the
  current compile schema if it explicitly supports that operation.
- Related but distinct source-backed claim -> keep it separate.
- Replacement or contradiction -> ask the user or return to structure/review;
  do not silently overwrite approved knowledge, and do not turn replacement into
  a same-section edit.
- Missing node, wrong ownership, or wrong relationship -> return to prose align.

### Step 4 — Ask The User Only When Needed

Ask a user question when business meaning, conflict resolution, weak support, or
no-write scope cannot be decided from evidence. The question must name the
business choice, not internal source-ref ids.

After the user answers, express the answer through the current surface:

- lifecycle confirmation for structure;
- a repaired compile action;
- an `unresolved[]` item;
- a skipped action with an explicit source-backed reason.

### Step 5 — Self-verify

- [ ] Only current phase commands and schemas were used.
- [ ] Only fields accepted by the current schema view were emitted.
- [ ] Every kept claim is supported by current source refs.
- [ ] Every no-write outcome has an explicit reason or user confirmation when
  the evidence was otherwise citation-eligible.
- [ ] Structure defects return to prose align instead of being hidden in compile.
- [ ] Apply/approval remains in the review gate.

</procedures>
