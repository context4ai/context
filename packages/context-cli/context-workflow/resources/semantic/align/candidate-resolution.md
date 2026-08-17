---
id: context.semantic.align.candidate-resolution
kind: procedure
media-type: text/markdown
applies-to:
  - duplicate
  - conflict
  - stable_id
  - path
  - unresolved
---

# Candidate Resolution Rules
<!-- Context workflow semantic resource. -->

Use these rules after reading the current align evidence views and before
authoring `context.structure.v1`. They define how current anomaly diagnostics
map to supported structure outcomes.

## Anomaly Signals

Anomaly diagnostics are mechanical warnings. Do not ignore them and do not treat
them as recommendations.

For each anomaly, choose one current outcome and record the reasoning in the
structure payload or user-facing explanation:

| Outcome | Use When |
|---|---|
| Accept the correction | The anomaly points to a real structure fix. Apply a concrete node, section, edge, or ownership correction supported by source refs. |
| Dismiss with rationale | The warning is mechanically true but semantically harmless. Keep the structure and state why in the confirmation summary. |
| Keep unresolved | The warning changes structure but source evidence is insufficient. Add an `unresolved[]` item instead of guessing. |

Known anomaly kinds:

| Kind | Meaning | Required handling |
|---|---|---|
| Missing evidence | A proposed node, section, or edge has no source-backed evidence. | Add source refs, remove it, or keep the issue unresolved. |
| Structure churn | A node was renamed, split, merged, replaced, or rejected during investigation. | Confirm the final id/title/target with the user or keep the ambiguity unresolved. |
| Duplicate evidence | The same source ref appears more than once for the same semantic role. | Deduplicate it or explain why the repeated ref supports different roles. |
| Broad review needed | The CLI collapsed many anomalies or reports aggregate risk. | Review the affected structure broadly; do not finalize solely from ordering. |

## Stable References

Use stable `node_ref`, `view_ref`, and `section_ref` values from the current
`context.structure.v1` payload for in-payload references. A NodeRef should be
safe, lower-case, and path-shaped, such as `entity/rspack` or
`domain/build-tooling`. `slug` is the required stable filename choice for a
View. `path` is derived from collection, optional containment, and slug; omit
it or use the exact CLI-derived value. Do not invent alternate reference
aliases.

When an edge or section points at knowledge:

- use the schema ref that matches the target layer:
  `node_ref` for a conceptual Node, `view_ref` for a collection view, and
  `section_ref` for a planned section;
- ensure the target NodeRef, ViewRef, or SectionRef exists in the current
  structure or approved knowledge;
- keep relation hints unresolved when the target does not exist;
- follow CLI diagnostics if a ref is unknown or stale.

Do not create alternate alias fields or non-schema candidate ledger fields.
They are not part of the current structure contract.

## Visible Labels And Audit Rationale

Humans need to understand merge, reject, rename, and replacement choices
without decoding temporary ids. Keep that discipline in the current structure
flow through current fields:

- use `title` and `summary` to name the final node in user-facing language;
- explain renamed/split/merged candidates in the confirmation summary, not by
  adding non-schema label fields;
- when a relation or rename cannot be settled from evidence, put the visible
  title/target clue in `unresolved[]`;
- when asking the user, phrase the choice with business labels ("Rspack build
  tool page" vs "Webpack page"), not with source refs or internal section ids.

NodeRef is the stable conceptual identity. ViewRef is the collection-specific
view identity and is the durable approved-page identity. SectionRef is the
stable planned-section identity under a ViewRef. Package paths are derived from
the approved ViewRef plus containment/slug; do not treat paths as an alternate
identity contract. Visible labels help humans review the choice, but they do
not authorize a different NodeRef, ViewRef, edge, or section ownership without
source-backed evidence and user confirmation.

## Duplicate And Conflict Handling

- Exact duplicate structure -> keep one node/section/edge and explain the
  duplicate in the confirmation summary.
- Same topic but different evidence boundary -> keep separate sections only
  when each section has a distinct source-backed role.
- Conflicting facts -> ask the user or keep an `unresolved[]` item. Do not
  pick a winner from title order or source order.
- Replacement or rename -> ask the user when it changes NodeRef, ViewRef,
  containment, slug, or the derived approved path. These are durable user-facing
  identities, not disposable labels.

## Self-verify

- [ ] Every accepted node, section, and edge has source-backed support.
- [ ] Every unresolved relation or conflict is explicit in `unresolved[]`.
- [ ] No non-schema candidate ledger fields or alias fields appear in the payload.
- [ ] NodeRef, ViewRef, and SectionRef values, not temporary labels or paths,
  are used for current references.
