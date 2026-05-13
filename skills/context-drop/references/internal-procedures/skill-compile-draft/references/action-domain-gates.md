# Action and Domain gates

Consult this reference when **`node.type` is `action` or `domain`**. For `entity` Nodes, ignore this file and follow the main SKILL.md procedure.

## Action Nodes (`node.type === "action"`)

Treat `node.action_gate` as the compile boundary for procedural claims. An Action Node exists because align found both scale and process evidence: at least two meaningful Sections or a child Action, plus steps/phases/trigger-handling-result/role collaboration/repeatable plan evidence. Actor, goal/outcome, repeatability, answerability, trigger, step, and phase claims **must** come from cited `raw_snippets[]` or the structured `action_gate.inference_sources` entries.

| Gate block | What it authorizes |
|---|---|
| `step_blocks` / `phase_blocks` / cited step snippets | `spec` or `example` Sections for procedure content |
| `actor_blocks`, `goal_blocks`, `outcome_blocks`, `repeatability_or_plan_blocks` | concise `description` / `spec` Sections when the same source refs are citation-eligible |
| Empty `trigger_blocks` | **No trigger Section.** Write goal or applicability if supported, but do not fabricate a trigger sentence. |
| `inference_sources.answerability.ref_nodes` | Becomes `refers_to_nodes[]` when the current Section depends on those Nodes; do **not** summarize those Nodes' facts inside this Node. |

If `action_gate` is absent on a Node whose `type` is `action`, treat it as a structural defect — emit a `structure_challenge` (see `references/structural-challenges.md`) instead of inventing process semantics.

If the current evidence can only support one thin Section or only a parallel option/config list, do not stretch it into procedure prose. Emit `skip` or `structure_challenge` so align can downgrade it to the owning Entity/Domain Section.

## Domain Nodes (`node.type === "domain"`)

Treat `node.domain_gate` as **grouping metadata only**. It explains scope and child grouping; it does **not** authorize new Section facts by itself.

- `scope_blocks` may help orient your Section coverage of the Domain's range but are not write authority.
- `child_refs` belong to the align graph, not to active Sections — do not turn the list into a Section.
- `grouping_reason` is align-time reasoning. Do **not** turn it into a `description` Section unless citation-eligible raw snippets state the same claim.

Recall the mount matrix limit: Domain Nodes allow only `description`, `warning`, `principle`, `decision`, `faq`. A spec / example / comparison / incident / changelog landing here is a kind/type mismatch — drop down the priority chain or `skip`.

## How this slots into the main procedure

- **Step 1 — Sanity-check**: after the standard `node.slug` / mount-matrix check, run the action_gate / domain_gate inspection above.
- **Step 2 — Classify**: respect the gate's authorization boundary when picking kinds.
- **Step 5 — Self-verify**: confirm no Section was written from evidence the gate disallowed.
