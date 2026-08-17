---
id: context.semantic.compile.scope-review-and-omit
kind: procedure
media-type: text/markdown
applies-to:
  - scope_omit
  - coverage
  - user_confirmation
---

# Scope Review and No-write Discipline
<!-- Context workflow semantic resource. -->

Consult this reference when you are tempted not to write citation-eligible
evidence, or when a proposed action looks redundant, low-value, miscoped, or
outside the current node.

## Core Rule

No-write is never a shortcut for uncertainty. It is valid only when one of these
conditions is true:

- the evidence is pure navigation, placeholder, duplicate, or unchanged content;
- the source refs are not owned by the selected planned section and must return
  to structure confirmation;
- the user explicitly confirms that this citation-eligible material should not
  become active knowledge;
- the current CLI diagnostics instruct a skip/no-write route.

Unsupported evidence is not a no-write shortcut. First repair the source refs,
narrow the claim, or return to prose align. Schema/source-ref failures must be
fixed, not hidden by skipping.

## Scope Review Pass

Before choosing a no-write outcome for citation-eligible evidence, inspect the
current node context and proposed actions:

1. **Covered-by check** — is the same source-backed claim already covered by
   another current action, approved section, or confirmed planned section?
   - Yes -> skip this action with a precise duplicate/covered-by reason when
     the current schema supports skip. Do not call this "omit"; it is a
     duplicate decision.

2. **Mergeable check** — should this evidence strengthen another write action?
   - Yes -> repair that other action only if the current schema exposes a safe
     update/merge path and the merged evidence boundary still supports every
     sentence. Do not drop the standalone evidence until the repaired action
     validates.

3. **Wrong node or section check** — does the evidence belong elsewhere?
   - Yes -> return to prose align and revise section ownership, node assignment,
     or typed edges. Do not paper over a wrong structure with skip decisions.

4. **Low-value but citation-eligible / provable low-value check** — can the current evidence prove that this item
   is navigation, placeholder, empty, non-knowledge, or outside the package's
   intended scope?
   - Yes -> ask the user whether to leave it unwritten, presenting the business
     claim and evidence in normal language.
   - No -> ask the user with the same evidence instead of silently omitting it;
     the agent's hunch is not a scope decision.

5. **Scope-wide miscope check** — do several items look low-value, or does the
   node boundary / planned section split look wrong?
   - Yes -> stop compile for this node and return to structure confirmation.
     A series of skips is not a substitute for correcting the structure.

## User Confirmation

When user confirmation is needed, ask a concrete question such as:

```text
This evidence appears source-backed but low-value for the active knowledge page:
<business claim>

Should it be left out of this compile round, or should it become a section?
```

Only after a specific user answer may the current action be skipped for business
scope reasons. General "continue" permission, delegated execution, or permission
to run commands is not confirmation.

## How This Slots Into The Main Procedure

- In compile drafting, use `skip` only when the current schema supports it and
  the reason is explicit.
- In structure repair, put unresolved scope problems in `unresolved[]` or return
  to the prose align gate.
- In review, do not approve a no-write outcome merely because it clears the
  queue; the user must have seen the relevant evidence and decision.
- No-write decisions are current-phase records only. They are not a substitute
  for approved knowledge, and they should not be treated as durable evidence
  that the source was fully handled unless the current ledger/diagnostic surface
  explicitly records that reviewed skip.

## Self-verify

- [ ] No citation-eligible claim was omitted without duplicate, scope, CLI, or
  user-confirmed reason.
- [ ] Covered-by and mergeable checks ran before asking the user to omit.
- [ ] Scope-wide miscope returned to prose align instead of many local skips.
- [ ] Unsupported evidence was repaired or returned upstream, not hidden.
- [ ] Structure problems returned to prose align.
- [ ] User-facing questions did not expose internal ids as the choice.
