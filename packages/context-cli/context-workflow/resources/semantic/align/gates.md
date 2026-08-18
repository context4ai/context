---
id: context.semantic.align.align-gates
kind: procedure
media-type: text/markdown
applies-to:
  - node_type
  - domain
  - action
  - edges
  - tags
---

# Node Classification Gates
<!-- Context workflow semantic resource. -->

Use these gates before every structure draft and before authoring the align
payload described by the current schema view.
Align owns Node type, tag, graph, planned Section, and ownership classification. It does **not** write Section prose.

Current schema mapping:

- Treat the action checklist, domain checklist, and inference tables as private
  working notes unless the current schema view explicitly exposes matching
  fields.
- In `context.structure.v1`, persist the outcome through `node_type`, `tags`,
  `summary`, `ownership`, `sections[].source_refs`, `edges[]`, and
  `unresolved[]`.
- Do not add unknown gate fields to the payload just because this procedure uses
  them for reasoning.

## Node Type Order

Answer in this order and stop at the first match:

1. **Action?** A large executable event / process with both:
   - scale: can support `planned_sections` with at least two distinct Section kinds, or contains at least one child Action;
   - process evidence: explicit steps, phases, trigger -> handling -> result, role collaboration, or repeatable plan. Parallel lists such as "three API modes" are not process evidence.
   Single-section user-story / scenario / incident records may be meaningful to
   a human reader, but the CLI does not infer that exception from source prose.
   If the structure cannot express at least two distinct Section kinds or a
   child Action, keep the material as a Section under the owning Node.
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

## Title and Source Heading Rules

Classify the Node by the evidence referent, not by the source file title, heading, or local section title. A source title is ordinary evidence just like body prose. It has no automatic right to become `node.title`, `aliases[]`, or `slug`.

After choosing `node_type`, choose the title to fit that type:

| Final type | Title shape |
|---|---|
| `entity` concrete | The concrete product, service, library, module, CLI, symbol, application, or system name. |
| `entity` term | The atomic concept or pattern name, without extra scope/process suffixes. |
| `domain` | The grouping scope that owns child Nodes. |
| `action` | The executable process / runbook / flow name that passed the Action Gate. |

Scope/process words in a source title are warning signals when proposed as an Entity title, not hard classification rules. Re-check the type/title when a proposed Entity title contains words such as "方案", "架构", "体系", "演练", "流程", "策略", "能力", "机制", "framework", "architecture", "system", "strategy", "process", or "drill". Keep the wording only when evidence shows it is the formal name of a concrete object or an atomic term.

Do not promote broad architecture/system/方案 content to `domain` just because it sounds like a scope. When the source has writable Sections but no resolvable current/existing child Nodes, use an Entity such as `[system]` or `[application]` and put the architecture facts in Sections. Use `domain` only when it groups child Nodes through supported `edges[]`.

Relation-only sources should not force title copying or dangling graph edges. Decide placeholder handling in this order:

1. If resolved current/existing child Nodes make the page a real grouping scope, keep the relation evidence as supported `edges[]` only when the Domain also has at least one source-backed planned Section.
2. If an explicit user-facing retrieval need or graph need makes the source/page identity valuable, and the title names an atomic concept or concrete object, keep that identity in `unresolved[]` until it has source-backed section evidence, a valid generated `parent_index` view with source-backed `contains` edges to child views, or a compile-time `skip` decision. Do not submit root-level `planned_sections: []` or ordinary source-bound `sections: []`.
3. Otherwise, skip navigation-only / placeholder-only material; keep a short
   `unresolved[]` note only when the deferred relation remains useful.

Do not create a hidden domain-gate object. A kept placeholder needs support:
source refs, approved graph support, or explicit user-confirmed retrieval value.
For Domain placeholders, write only resolved current/existing children as typed
`edges[]`; if all children are unresolved/deferred relation clues, keep those
target hints in `unresolved[]`. If the source names only an atomic concept and
that term is useful on its own, prefer a concise term Entity title without
scope/process suffixes.

For no-write placeholder summaries, describe only the preserved page identity and unresolved navigation clues. Do not say the Node "provides navigation/links/relations to X" unless those targets are resolved graph children or rendered links; say the source contains deferred navigation clues instead.

## Section Promotion Gate

Classify local evidence as a Section before creating a child Node/View. A
heading, table row, FAQ label, or short sub-topic does not by itself establish a
standalone page.

Promote a Section to a child View only when at least one condition is supported
by source evidence:

1. The title is a concrete product/code object/system/module/library, not just a
   local heading.
2. The item is an atomic term or pattern that answers standalone lookup
   questions outside the parent page.
3. The item clears the Action Gate or Domain Gate.
4. The source gives it independent article identity: owner/date, lifecycle,
   timeline, tracking record, or cross-cutting support scope.

Use one content-neutral test for every proposed child View: does cited evidence
support an independent subject identity, enough context to stand alone, and a
separate retrieval need? A heading, section kind, collection name, or contains
edge is not sufficient by itself. The CLI warns when many same-source,
single-section child Entities look mechanically fragmented, but it does not
reject a page merely because of its content type.

## Entity Tag Rules

Use `tags` to state what the Entity is. Legal combinations:

| Case | Tags |
|---|---|
| Runtime/code object | one A tag: `app`, `service`, `lib`, `cli`, `module`, or `symbol` |
| Product-analysis object | one B tag: `application` or `system` |
| Code + product object | one A tag plus one B tag |
| Pure term / pattern | only `term` |

`term` is mutually exclusive with A/B tags. React is `[lib]`, not `[lib, term]`; if a separate term entry is useful, create another Entity tagged `[term]` and let the structure plan express the relation as a typed edge or unresolved relation with `source_refs[]`.

Do not inherit scope tags mechanically. If a parent Entity is tagged `system` or
`application`, a child Entity should repeat that tag only when it is itself an
independent system/application. Local aspects under that parent should either
use their own shape tag or remain Sections.

## Action Gate

Use `node_type: action` only after the Node Type Order says action. Fill the
action reasoning checklist in your working notes; persist only fields accepted by
the current structure schema.

The action probe uses five booleans as a reasoning checklist, but the semantic
bar is:

| Field | Meaning | Evidence rule |
|---|---|---|
| `has_steps_or_phases` | Process evidence exists: steps, phases, trigger -> handling -> result, role collaboration, or repeatable plan. | Hard requirement; support it from span evidence. |
| `has_actor_or_role` | A user, system, operator, service, or role performs the work. | May be inferred; record the source. |
| `has_outcome_or_goal` | The process has a target result, acceptance condition, or operational goal. | May be inferred; record the source. |
| `is_repeatable_or_planned` | The work is repeatable, scheduled, policy-like, or intentionally planned. | May be inferred; record the source. |
| `queries_answerable_with_refs` | The Node can answer how/when/who/what-to-do questions from cited spans. | May be inferred; record the source. |

Do not emit an Action for a single sentence, a one-off conclusion, a short operation, or a parallel enumeration. Those become Sections under the owning Entity or Domain. The CLI does not infer single-Section Action exceptions from source prose; represent the material with enough structure or keep it as a Section.

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
| "X impact on Y" | Section under X plus a typed edge or unresolved relation to Y when the evidence supports it |
| "Y under X condition" | Section under Y; X is a condition in the Section body |
| "X subsystem migration" | Action only if it clears the Action Gate; otherwise `decision` Section under X |
| "X error collection" / "X FAQ collection" | `faq` / `incident` Sections under X |

## Domain Gate

Use `node_type: domain` only for a scope that groups child Nodes. Keep this
domain reasoning checklist in working notes and persist supported relations through current
`edges[]` or `unresolved[]`:

| Field | Meaning |
|---|---|
| `scope_refs[]` | Source refs that describe the scope boundary or grouping. |
| `child_refs[]` | Working-note candidate ids, local refs, or final slugs for children in the scope; persist valid ones as `edges[]`. |
| `grouping_reason` | Why these children belong together under this domain. |

If a domain has no resolvable child refs, no clear grouping reason, or only one same-file child without a broader scope, do not emit a Domain. For navigation-only / placeholder-only sources with only deferred children, skip the Node after ruling out standalone retrieval or graph value for an atomic-term or concrete Entity; keep only useful unresolved relation notes. Emit an Entity only when evidence names an atomic term or concrete object and choose its Entity tag yourself. The CLI rejects invalid Domain gates; it does not auto-downgrade a Domain or choose fallback tags.

Scope-name titles such as "X 业务域", "Y 领域", "business domain", or "technical area" are a warning sign when proposed as Entity. Keep them as Entity only when the subject is an atomic term or concrete object; otherwise use Domain with supported child edges or unresolved relation hints.

## Edge Gate

Use a typed edge only when all four checks pass:

1. Both `from` and `to` nodes exist in the current structure or approved
   knowledge.
2. The relation type is in the current closed set (`is_a`, `contains`,
   `depends_on`, `corresponds_to`, `causes`, `triggers`, `prerequisite`,
   `applies_to`, `verified_by`, `supersedes`).
3. `source_refs[]` cite evidence for the relation itself, not just for one
   endpoint.
4. The relation is stronger than a vague "related" hint.

If any check fails, write an `unresolved[]` item instead of an edge.

If the source sentence states the relation with uncertainty, keep the edge only
when the uncertainty is source-authored and preserved through
`confidence: possible` or `confidence: hypothesis`. Do not use `confidence` for
Agent uncertainty. If you are uncertain whether the evidence supports the
relation, write `unresolved[]` instead.

## Inference Sources

Inference sources are working notes for the action reasoning checklist; do not
persist this object unless the current schema explicitly exposes it:

```yaml
inference_sources:
  actor:
    source_type: explicit-span
    source_refs: ["file:docs/runbook.md#span:steps L10-18@<span-hash>"]
    rationale: "The span names the operator role."
  outcome_or_goal:
    source_type: inferred-from-span
    source_refs: ["file:docs/runbook.md#span:steps L10-18@<span-hash>"]
    rationale: "The span describes recovery as the expected result."
  repeatability_or_plan:
    source_type: heading-and-span
    source_refs: ["file:docs/runbook.md#span:steps L10-18@<span-hash>"]
    rationale: "The runbook heading and ordered list indicate planned reuse."
  answerability:
    source_type: explicit-span
    source_refs: ["file:docs/runbook.md#span:steps L10-18@<span-hash>"]
    rationale: "The steps answer how the operation is performed."
```

Allowed `source_type` values:

| Value | Use when |
|---|---|
| `explicit-span` | The evidence span directly states the signal. |
| `heading-and-span` | The heading plus span text together support the signal. |
| `ref-node` | An existing or same-decision Node reference supplies the signal. Include `ref_nodes`. |
| `inferred-from-span` | The signal is inferred from span content. Keep the rationale short and concrete. |

Each source must include `rationale` when inferred and at least one of `source_refs[]` or `ref_nodes[]`.

## Final Reflection

- Entity cannot pick a legal tag, or depends on its upstream title to make sense -> write it as a Section under the upstream Node or change type before submit.
- Action only supports one Section -> confirm its standalone retrieval value, write it as a Section under its owner, or add another source-backed Section / child Action. Multiple source-backed Sections may use the same kind; the CLI does not manufacture semantic variety to validate an Action.
- Action "steps" are parallel options/configs -> route to Entity `comparison` / `spec` / `description`.
- Domain has no children -> delete it or merge it into a larger Domain.

## Current CLI Quality Diagnostics

Current `context.structure.v1` validation preserves the old Node quality
checks as deterministic diagnostics:

| Diagnostic | Meaning | Required response |
|---|---|---|
| `schema.section_kind_invalid` | A planned Section uses a kind outside the current prose kind set. | Replace it with a kind from the schema view; do not invent local kind names. |
| `schema.section_kind_mount_invalid` | A planned Section kind cannot be mounted on the chosen `node_type`. | Choose a kind allowed by the mount matrix, or reclassify the Node before confirming structure. |
| `tags.term_conflict` | An Entity uses `term` together with concrete runtime/product tags such as `lib`, `service`, `application`, or `system`. | Split the term from the concrete object, or remove the conflicting tag before staging. |
| `node.description_dominates` | A non-Action Node has at least half of its planned Sections as `description`. | Re-run kind precision. Keep it only when source evidence is genuinely narrative; otherwise split into `example`, `spec`, `comparison`, `faq`, `incident`, `decision`, `warning`, or `principle`. |
| `node.thin_concrete_entity` | A concrete Entity has one Section and no child Nodes. | Keep it only when it has stable standalone retrieval value; otherwise merge it into the owning Node. |
| `node.children_should_be_sections` | One parent contains many same-source, single-section child Entities with no stable shape tag. | Merge those children into parent Sections unless the user confirms each child has standalone lookup value. |
| `node.term_expanded_beyond_definition` | A `term` Entity has grown past a compact definition or owns children. | Move rules, procedures, designs, and examples to the owning Node; keep the term entry narrow. |
| `node.action_too_thin` | An Action has one planned Section and no child Action. | Confirm its standalone retrieval value, keep it as a Section under the owning Node, add another source-backed Section, or add a child Action. This warning does not require artificial Section-kind diversity. |
| `node.domain_without_children` | A Domain has no source-backed `contains` child edge. | Add supported children, keep an explicitly confirmed no-write placeholder, or reclassify the Node. |
| `tags.child_inherits_system` | A child Entity repeats its parent `system` / `application` scope tag. | Retag by the child’s own shape/scope, or keep the child as a Section if it is only a local aspect. |
| `edge.confidence_invalid` | An edge declares a confidence value outside the current schema. | Use only `possible` or `hypothesis`, or omit the field for source-certain relations. |

Warnings are not automatic blockers, but they are not suggestions to ignore.
Resolve them or include the user-confirmed rationale when confirming structure.
