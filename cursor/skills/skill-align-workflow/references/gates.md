# Node Classification Gates

Use these gates before every candidate batch and immediately before `align-structure-decision`.
Align owns Node type, tag, graph, planned Section, and ownership classification. It does **not** write Section prose.

## Node Type Order

Answer in this order and stop at the first match:

1. **Action?** A large executable event / process with both:
   - scale: can support `planned_sections` with at least two distinct Section kinds, or contains at least one child Action;
   - process evidence: explicit steps, phases, trigger -> handling -> result, role collaboration, or repeatable plan. Parallel lists such as "three API modes" are not process evidence.
2. **Entity?** A concrete independent subject with retrieval value: deployable code, product/application/system, library/module/CLI/symbol, or an atomic term/pattern.
3. **Domain?** A container/scope that groups at least one child Node.
4. Otherwise do not create a Node; leave the material for compile as a Section under the owning Node.

Good examples:

| Type | Examples |
|---|---|
| `domain` | "X business domain", "Y technical area", "Z research topic" |
| `entity` concrete | `@acme/api-server`, `@acme/ui-kit` `Button`, "X sub-application" |
| `entity` term | "X identifier", "Y business metric", idempotency |
| `action` | "user submits X request end-to-end flow", "operator executes Y change flow", "team Z release flow" |

## Entity Tag Rules

Use `tags` to state what the Entity is. Legal combinations:

| Case | Tags |
|---|---|
| Runtime/code object | one A tag: `app`, `service`, `lib`, `cli`, `module`, or `symbol` |
| Product-analysis object | one B tag: `application` or `system` |
| Code + product object | one A tag plus one B tag |
| Pure term / pattern | only `term` |

`term` is mutually exclusive with A/B tags. React is `[lib]`, not `[lib, term]`; if a separate term entry is useful, create another Entity tagged `[term]` and let compile use Section-local `refers_to_nodes[]`.

## Action Gate

Use `node_type: action` only after the Node Type Order says action. Fill `action_probe` and `action_gate`.

`action_probe` still uses the five schema booleans, but the semantic bar is:

| Field | Meaning | Evidence rule |
|---|---|---|
| `has_steps_or_phases` | Process evidence exists: steps, phases, trigger -> handling -> result, role collaboration, or repeatable plan. | Hard requirement; support it from block evidence. |
| `has_actor_or_role` | A user, system, operator, service, or role performs the work. | May be inferred; record the source. |
| `has_outcome_or_goal` | The process has a target result, acceptance condition, or operational goal. | May be inferred; record the source. |
| `is_repeatable_or_planned` | The work is repeatable, scheduled, policy-like, or intentionally planned. | May be inferred; record the source. |
| `queries_answerable_with_refs` | The Node can answer how/when/who/what-to-do questions from cited blocks. | May be inferred; record the source. |

Do not emit an Action for a single sentence, a one-off conclusion, a short operation, or a parallel enumeration. Those become Sections under the owning Entity or Domain.

Action anti-examples:

| Candidate | Correct routing |
|---|---|
| "migrate to X tool" as one conclusion | `decision` Section under the owning Entity |
| "component X usage" as one sentence | `description` + maybe `example` under X |
| "submit -> validate -> generate" as one unexpanded sentence | `spec` Section under X/Y |
| "three API call modes" | `comparison`, `spec`, or `description` Section; not Action |

## Fake Entity Gate

A relationship-style title is only suspicious by itself. Downgrade or change type when at least **two** signals are true:

1. Title contains relationship language such as "X impact on Y", "Y under X", "Y side of X", "X migration", or "X collection".
2. No legal Entity tag fits.
3. The Node does not stand alone away from its upstream Node.

Repairs:

| Pattern | Repair |
|---|---|
| "X impact on Y" | Section under X with `refers_to_nodes: [Y]` |
| "Y under X condition" | Section under Y; X is a condition in the Section body |
| "X subsystem migration" | Action only if it clears the Action Gate; otherwise `decision` Section under X |
| "X error collection" / "X FAQ collection" | `faq` / `incident` Sections under X |

## Domain Gate

Use `node_type: domain` only for a scope that groups child Nodes. Fill:

| Field | Meaning |
|---|---|
| `scope_blocks[]` | Blocks that describe the scope boundary or grouping. |
| `child_refs[]` | Candidate ids, local refs, or final slugs for children in the scope. |
| `grouping_reason` | Why these children belong together under this domain. |

If a domain has no resolvable child refs, no clear grouping reason, or only one same-file child without a broader scope, emit an Entity instead.

Scope-name titles such as "X 业务域", "Y 领域", "business domain", or "technical area" are a warning sign when proposed as Entity. Keep them as Entity only when the subject is an atomic term or concrete object; otherwise use Domain with `domain_gate.child_refs`.

## Inference Sources

`action_gate.inference_sources` is required and must be a structured object with four keys:

```yaml
inference_sources:
  actor:
    source_type: explicit-block
    evidence_blocks: [7a6f4c9d2e10]
    rationale: "The block names the operator role."
  outcome_or_goal:
    source_type: inferred-from-block
    evidence_blocks: [7a6f4c9d2e10]
    rationale: "The block describes recovery as the expected result."
  repeatability_or_plan:
    source_type: heading-and-block
    evidence_blocks: [7a6f4c9d2e10]
    rationale: "The runbook heading and ordered list indicate planned reuse."
  answerability:
    source_type: explicit-block
    evidence_blocks: [7a6f4c9d2e10]
    rationale: "The steps answer how the operation is performed."
```

Allowed `source_type` values:

| Value | Use when |
|---|---|
| `explicit-block` | The evidence block directly states the signal. |
| `heading-and-block` | The heading plus block text together support the signal. |
| `ref-node` | An existing or same-decision Node reference supplies the signal. Include `ref_nodes`. |
| `inferred-from-block` | The signal is inferred from block content. Keep the rationale short and concrete. |

Each source must include `rationale` when inferred and at least one of `evidence_blocks[]` or `ref_nodes[]`.

## Final Reflection

- Entity cannot pick a legal tag, or depends on its upstream title to make sense -> downgrade to Section or change type.
- Action only supports one Section -> downgrade to Section. The discriminator is scale, not the presence of "step" words.
- Action "steps" are parallel options/configs -> route to Entity `comparison` / `spec` / `description`.
- Domain has no children -> delete it or merge it into a larger Domain.
