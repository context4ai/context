---
id: context.semantic.compile.structural-challenges
kind: procedure
media-type: text/markdown
applies-to:
  - ownership
  - section_ownership
  - unresolved
---

# Structural and ownership challenges
<!-- Context workflow semantic resource. -->

Consult this reference when the cited evidence **cannot be written as a Section under the current confirmed structure**:

- The evidence describes a coherent process that should be its own `action` Node (not a Section here).
- The evidence implies a missing `depends_on` edge between Nodes.
- The evidence belongs under a different parent Node.
- A finalized shared-block split leaves this Node with only secondary, non-citable evidence.
- A visible `context_only` or secondary-shared block contains facts that need citation, requiring an ownership upgrade.

In these cases, do **not** force the content into a Section. The current
`context.compile-actions.v1` schema does not accept challenge actions. Stop the
compile draft for this Node, report the structure defect, and return to the
prose align gate so the structure can be revised as `unresolved[]`, a corrected
node, a corrected section plan, or a typed edge.

## When to challenge vs. when to skip

| Situation | Route |
|---|---|
| Evidence is a repeatable procedure with steps that clearly warrant a sub-Action | Return to align and propose a new or corrected `action` node. |
| Evidence depends on a Node that the current structure does not link to this Node | Return to align and add a source-backed typed edge such as `depends_on`, `prerequisite`, or `applies_to`, or keep it in `unresolved[]` when evidence/target is incomplete. |
| Evidence belongs under a different parent | Return to align and move the planned section source refs to the correct node. |
| The planned section has no primary source-backed evidence for this Node | Return to align and revise section ownership/source refs, or remove the node if it should not exist. |
| The Node should not exist because its evidence belongs elsewhere | Return to align and remove or replace the node before compile. |
| Background/context evidence holds facts this Node needs to cite | Return to align and make those source refs owned by the correct planned section, or keep the issue unresolved. |

Use challenge labels only as private reasoning labels in your user explanation.
Do not put them in `context.compile-actions.v1`.

## Report shape

When this reference triggers, do not submit a compile payload for the affected
Node. Report a compact structure repair request to the user and the align gate:

```jsonc
{
  "reason_code": "structure_reconfirmation_required",
  "issue": "missing_action_node",
  "view_ref": "<matches selected view_ref>",
  "summary": "The cited evidence is a repeatable procedure.",
  "source_refs": ["file:docs/runbook.md#span:ops L40-55@<span-hash>"],
  "align_repair": "Add a supported action node or keep the issue in unresolved[]."
}
```

The actual committed repair is a revised `context.structure.v1` payload. Use
the align schema and validation diagnostics for that repair; do not invent a
compile action shape.

## What these are NOT

- **Not a substitute for `skip`** when raw simply has no write-worthy fact for this Node.
- **Not a Section.** Structure defects never appear in active knowledge.
- **Not a compile action.** Do not encode them as `op` values in
  `context.compile-actions.v1`.
- **Not a free retargeting path.** Do not switch `view_ref`, `section_id`, or
  `source_refs[]` inside compile merely to make validation pass. The confirmed
  structure must be repaired first.
- **Not a free upgrade path.** Exact text views expose visible evidence text for
  inspection, but they do not change section ownership. If you need to cite
  background content, return to align and revise ownership/source refs.

## How this slots into the main procedure

- **Step 3 — Build actions**: when evidence implies a missing Action, missing
  edge, wrong parent, or needed ownership/source-ref repair, stop the compile
  draft for this Node and return to align instead of writing a Section.
- **Step 5 — Self-verify**: no Section write cites source refs outside the
  planned section ownership; if any did, remove the action and return to align.
- **Review handoff**: if a user asks why compile stopped, explain the structure
  effect plainly: paths, ownership, and relations are frozen at compile time, so
  these repairs need a new confirmed structure rather than a draft-page patch.
