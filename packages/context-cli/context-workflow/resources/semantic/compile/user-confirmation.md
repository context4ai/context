---
id: context.semantic.compile.user-confirmation
kind: procedure
media-type: text/markdown
applies-to:
  - user_confirmation
  - weak_evidence
  - scope_omit
---

# User Confirmation Paths
<!-- Context workflow semantic resource. -->

Consult this reference when weak evidence, conflict resolution, or no-write
scope requires a human choice before compile/review can
continue.

## What Counts As Confirmation

Only a specific user reply to a specific current question counts. These are not
confirmation:

- delegated mode;
- a blanket "continue" or "yes go ahead" from earlier in the session;
- permission to run shell commands;
- an approval for a different node, section, source, or earlier compile round.

If you cannot point at the exact current question and answer, ask the user
again or leave the issue unresolved.

## When To Ask

Ask the user when:

- evidence is weak and may require a business decision before it can be
  represented as source-mirrored knowledge;
- two source-backed claims conflict;
- citation-eligible material looks low-value and may be intentionally left out;
- structure ownership or relation intent is ambiguous and cannot be decided from
  evidence alone.

The question should use business language. Do not expose internal source-ref ids,
section ids, or payload paths as the choices.

## Weak Support Handling

Weak support means the cited source refs plausibly support a business decision,
but the agent cannot mirror the reader-facing wording from one continuous source
span without changing meaning.

Rules:

- Weak support is not a compile-time license to write summarized or rewritten
  body text.
- It is not acceptable for an update, replacement, withdrawal, ownership move,
  relation reversal, or section relocation unless stronger source evidence or a
  fresh structure confirmation backs that change.
- Present the business claim and the cited evidence meaning to the user. Do not
  ask "confirm source_ref X" or expose section ids as the choice.
- If the user confirms, express that confirmation through the current surface:
  lifecycle confirmation for structure, or a source-backed skip/unresolved
  reason. If the user declines, narrow the claim, cite stronger evidence, split
  the section, or leave the item unresolved.

User confirmation permits weak support; it does not permit unsupported evidence,
contradictory claims, fabricated relationships, or stale source refs.

## No-write / Scope Confirmation

Use this when citation-eligible material looks real but may be intentionally
left unwritten because it is duplicate, navigation-only, out of scope, too weak,
or better owned by another node.

- If the user confirms no-write, record it as a current `skip` with
  `source_refs[]` when the compile schema permits reviewed skips, or as a
  structure `unresolved[]` / handoff note when the decision belongs to align.
- If the user declines no-write, revise the structure or compile action into a
  concrete source-backed write.
- Do not silently omit citation-eligible evidence merely because it feels low
  value. Either cite a reviewed skip, leave an unresolved item, or ask the user.

## How To Record The Answer

Use the current phase surface, not a separate decision schema:

- For structure confirmation, write the confirmed lifecycle fields only after
  the user confirms the structure proposal.
- For no-write scope, emit a current `skip` or `unresolved[]` item only when the
  current schema supports it and include the user-facing reason.
- For conflict or weak evidence, repair the compile action, ask another
  question, or return to structure confirmation.

Do not invent confirmation fields. If the current schema has no place to record
the answer, keep it in the user-facing handoff and stop before the write that
would require it.

## Grouping Questions

You may group several questions only when they have the same business decision,
same evidence strength, and same consequence. Do not group:

- questions with different source boundaries;
- one fact-level decision with one wording decision;
- one item with evidence and another without evidence;
- conflict resolution with no-write scope confirmation.

When grouping is valid, ask one compact question listing each grouped claim and
the plain-language evidence meaning. If the user confirms, apply the same
current-surface confirmation to every grouped item. When in doubt, ask
separately.

## Self-verify

- [ ] Every confirmed outcome maps to a specific current user answer.
- [ ] The question described the business effect before any schema or command.
- [ ] Structure/no-write confirmation was not inferred from generic approval.
- [ ] Weak support was routed to structure confirmation, stronger evidence,
  split sections, or unresolved handoff instead of compile-written body text.
- [ ] Every no-write outcome for citation-eligible evidence has a reviewed skip,
  unresolved item, or explicit user-facing handoff.
- [ ] No unsupported evidence was accepted merely because the user allowed the
  phase to continue.
