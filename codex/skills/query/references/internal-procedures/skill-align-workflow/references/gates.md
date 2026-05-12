# Candidate Validation Gates

Use these gates before producing `align-structure-decision`. The CLI may reject malformed gates or downgrade weak `domain` / `action` proposals to `entity`.

## Action Gate

Use `node_type: action` only when the candidate is a user story, runbook, how-to, roadmap, or other planned procedure. Fill both `action_probe` and `action_gate`.

`action_probe` and `action_gate` use the same five booleans:

| Field | Meaning | Evidence rule |
|---|---|---|
| `has_steps_or_phases` | The source contains explicit steps, phases, ordered work, or a procedural sequence. | Hard requirement. Must be directly supported by block evidence. |
| `has_actor_or_role` | A user, system, operator, service, or role performs the work. | May be inferred, but inference must be recorded. |
| `has_outcome_or_goal` | The action has a target result, acceptance condition, or operational goal. | May be inferred, but inference must be recorded. |
| `is_repeatable_or_planned` | The work is repeatable, scheduled, policy-like, or intentionally planned. | May be inferred, but inference must be recorded. |
| `queries_answerable_with_refs` | The resulting Node can answer how/when/who/what-to-do questions from cited blocks. | May be inferred, but inference must be recorded. |

`has_steps_or_phases: false` means do not emit an action Node. If the subject has a stable named definition that people can reference, use `entity` with tag `term`. Routing schemes, durable rules, and data-shape descriptions belong inside the matching domain/entity/action Sections (`spec`, `principle`, `decision`, `comparison`, `warning`, and related mounted kinds).

## Term Entity Boundary

Use `entity` + `tags: [term]` only for a stable named definition. The core content should fit a 1-3 sentence glossary entry answering "what is X?" without if/else branches, steps, trade-offs, or "we choose" reasoning.

Decision tree:

1. If the subject is a procedure, ordered work, runbook, how-to, or repeated planned operation, use an `action` Node.
2. If the subject is a concrete product, service, system, app, library, module, CLI, or code symbol, use the matching concrete `entity` tag.
3. If the content is a rule, risk, design choice, comparison, data shape, durable behavior, or operational detail, do not create a Node for it; place it as a Section under the owning Node.
4. If the subject is a stable named definition that can be written as a short glossary entry and referenced across documents, use `entity` + `tags: [term]`.
5. If explaining the subject requires alternatives, steps, condition branches, trade-offs, or "we choose" reasoning, it is not `term`; route it to an owning Section or an `action` Node.

Term boundary TTL: re-run this decision tree before every candidate-ops batch and again immediately before `align-structure-decision`. If you have processed more than one batch or about ten candidates since the last check, treat the previous check as expired.

Good `term` examples:

- `Data Region`: a named deployment or compliance scope used across documents.
- `IDC` / `Region`: named scope terms with stable definitions.
- `request-id`: a named identifier with a stable meaning.
- `target-region`: a named cookie, header, or routing key.
- `Dynamic Site Acceleration`: a named traffic acceleration category.

Not `term`:

- cookie-plus-IP routing: a conditional routing scheme; put it in the owning service/system as `spec`.
- shared load-balancer rollout: a design choice with constraints; use `spec`, `principle`, or `decision` under the owning entity.
- six-dimensional resilience matrix: a structured comparison/framework; use a domain/entity `comparison` or `spec` Section.
- CDN scheduling strategy: service behavior and design choices; model the CDN or traffic service as `service` and place the strategy in Sections.

## Inference Sources

`action_gate.inference_sources` is required and must be a structured object with four keys:

```yaml
inference_sources:
  actor:
    source_type: explicit-block
    evidence_blocks: [b0001]
    rationale: "The block names the operator role."
  outcome_or_goal:
    source_type: inferred-from-block
    evidence_blocks: [b0001]
    rationale: "The block describes recovery as the expected result."
  repeatability_or_plan:
    source_type: heading-and-block
    evidence_blocks: [b0001]
    rationale: "The runbook heading and ordered list indicate planned reuse."
  answerability:
    source_type: explicit-block
    evidence_blocks: [b0001]
    rationale: "The steps answer how the operation is performed."
```

Allowed `source_type` values:

| Value | Use when |
|---|---|
| `explicit-block` | The evidence block directly states the signal. |
| `heading-and-block` | The heading plus block text together support the signal. |
| `ref-node` | An existing or same-decision Node reference supplies the signal. Include `ref_nodes`. |
| `inferred-from-block` | The signal is inferred from block content. Keep the rationale short and concrete. |

Each source must include `rationale` and at least one of `evidence_blocks[]` or `ref_nodes[]`. Do not write free-text-only inference explanations.

## Domain Gate

Use `node_type: domain` only for a scope that groups multiple child Nodes. Fill:

| Field | Meaning |
|---|---|
| `scope_blocks[]` | Blocks that describe the scope boundary or grouping. |
| `child_refs[]` | Candidate ids, local refs, or final slugs for children in the scope. |
| `grouping_reason` | Why these children belong together under this domain. |

If a domain has no resolvable child refs, no clear grouping reason, or only one same-file child without a broader scope, emit an `entity` instead. Weak domain gates are downgraded by finalize and recorded in `audit_warnings`.
