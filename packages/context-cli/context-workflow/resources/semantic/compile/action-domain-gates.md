---
id: context.semantic.compile.action-domain-gates
kind: procedure
media-type: text/markdown
applies-to:
  - action
  - domain
  - section_kind
  - coverage
---

# Action and Domain gates
<!-- Context workflow semantic resource. -->

Consult this reference when **`node.node_type` is `action` or `domain`**. For
`entity` Nodes, ignore this file and follow the main compile procedure.

## Action Nodes (`node.node_type === "action"`)

Treat the confirmed node type and planned sections as the compile boundary for
procedural claims. An Action Node exists because align confirmed process
evidence: steps/phases, trigger -> handling -> result, role collaboration, or a
repeatable plan. Actor, goal/outcome, repeatability, answerability, trigger,
step, and phase claims **must** come from the selected planned section
`source_refs[]`; do not invent process semantics from the title alone.

| Evidence pattern | What it authorizes |
|---|---|
| Planned section source refs contain ordered steps, phases, or repeatable handling | `spec` or `example` Sections for procedure content. |
| Planned section source refs explicitly name actor, goal, outcome, or repeatability | Concise `description` / `spec` Sections using those same refs. |
| No source ref states a trigger | **No trigger Section.** Write goal or applicability if supported, but do not fabricate a trigger sentence. |
| Existing structure edge or unresolved relation indicates another Node is required for answerability | Mention only what the current source refs support; keep the relation in structure, not in compile action fields or verbatim body. |

If the planned sections for an `action` node do not contain source-backed
process evidence, treat that as a structural defect and return to align using
[structural-challenges.md](structural-challenges.md). Do not invent an action
body just because the node type is `action`.

If the current evidence can only support one thin Section or only a parallel
option/config list, do not stretch it into procedure prose. Emit `skip` for the
unsupported planned section, or return to align so the node can be revised. The
CLI does not auto-downgrade an Action or choose replacement Entity tags.

## Domain Nodes (`node.node_type === "domain"`)

Treat Domain nodes as grouping surfaces. The domain's scope and child grouping
are expressed by confirmed `edges[]` and by source-backed planned sections; they
do **not** authorize new reader-facing facts by themselves.

- Source refs on planned sections may orient coverage of the Domain's range, but
  only those refs can support reader-facing text.
- Child relations belong to `structure.yaml` typed edges, not active Sections;
  do not turn a child list into a Section.
- Align-time grouping rationale is not evidence. Do **not** turn it into a
  `description` Section unless the planned source refs state the same claim.

Recall the mount matrix limit: Domain Nodes allow only `description`, `warning`, `principle`, `decision`, `faq`. A spec / example / comparison / incident / changelog landing here is a kind/type mismatch — drop down the priority chain or `skip`.

## How this slots into the main procedure

- **Step 1 — Sanity-check**: after the standard `node.id` / mount-matrix check,
  run the action/domain inspection above.
- **Step 2 — Classify**: respect the gate's authorization boundary when picking kinds.
- **Step 5 — Self-verify**: confirm no Section was written from evidence the gate disallowed.
