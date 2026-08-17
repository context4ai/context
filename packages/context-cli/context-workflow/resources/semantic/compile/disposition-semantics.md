---
id: context.semantic.compile.disposition-semantics
kind: procedure
media-type: text/markdown
applies-to:
  - unsupported
  - replacement
  - withdrawal
  - stale
  - source_retargeting
---

# Disposition Semantics
<!-- Context workflow semantic resource. -->

Consult this reference when a compile/review issue looks like unsupported
content, stale evidence, replacement, withdrawal, removal, or source
retargeting.

Use only the current workflow surfaces. Do not introduce extra disposition
command names or hidden mode-specific payloads. If the current CLI schema does
not expose a write shape, route the issue to structure confirmation,
review/user confirmation, or `unresolved[]`.

## Current Disposition Routes

| Situation | Current route |
|---|---|
| Source span can be mirrored directly | Omit `content`; let compile materialize `verbatim`. |
| Source-backed wording needs translation, compression, or reorganization | Do not write it in compile. Split the evidence into source-mirrored sections, ask for structure revision, or leave the issue unresolved for user review. |
| Evidence is citation-eligible but intentionally not written | Use `skip` only when the current compile schema exposes it and the reason is explicit; otherwise ask the user or leave `unresolved[]`. |
| Existing approved section needs a source-backed correction | Use `update` only when `node-context` exposes the target and the current schema supports update. |
| New evidence changes the meaning of an existing approved section | Stop and route to user/structure review; do not emulate replacement with `update` or summarized body text. |
| Approved content is no longer supported by current source evidence | Stop and route to user/structure review. Do not physically remove content from compile. |
| Source ref is stale or points at a moved span | Repair with current CLI source-ref views. Do not invent a hidden source-retargeting action. |
| Evidence belongs under another node, section, or relation | Return to prose align and revise structure ownership or edges. |
| Claim is unsupported by cited evidence | Remove or narrow the claim, cite stronger evidence, or return to structure. User permission cannot make unsupported evidence valid. |

## Unsupported Content

Unsupported content means the reader-facing claim adds facts, scope, direction,
terms, or conclusions that the cited source refs do not contain.

Do not handle unsupported content by:

- converting it to a vague summary;
- silently writing `empty`;
- treating user approval as evidence;
- physically deleting approved knowledge from compile;
- copying a stronger-looking source ref from another node or section.

The valid repair paths are:

1. narrow the action to what the owned refs support;
2. cite stronger refs owned by the same planned section;
3. split unrelated facts into separately supported actions;
4. return to align when ownership or relationship structure is wrong;
5. ask the user only for business choice, not for permission to bypass evidence.

## Replacement And Withdrawal

Changing approved knowledge is higher risk than adding a new source-backed
section.

- `update` is for the same section identity when meaning does not change.
- Replacement is for a meaning change where the previous section should remain
  auditable and the replacement is source-backed.
- Withdrawal is for content that should no longer be active but should remain
  auditable.
- Physical deletion is not a compile disposition in the current workflow.

The current compile action schema does not expose replacement or withdrawal as
write operations. Do not emulate them with summarized body text, an `update`, or
a hidden field. Stop and route to the next appropriate gate.

## Stale Evidence And Source Retargeting

Source retargeting is expressed as current source-ref repair:

- read only current CLI evidence views;
- use the canonical source refs returned by those views;
- revalidate before staging;
- if no surviving source span supports the previous claim, route to user/structure
  review, no-write confirmation, or unresolved structure review.

Do not create a hidden source-retargeting decision or patch source refs by hand.

## Self-verify

- [ ] No non-current disposition mode name was emitted as a current payload field.
- [ ] Unsupported evidence was repaired, removed, or returned upstream.
- [ ] Replacement/withdrawal did not appear as unsupported compile payload fields.
- [ ] No compile path physically removed approved knowledge.
- [ ] Stale source refs were repaired from CLI views, not guessed.
