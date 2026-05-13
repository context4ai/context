---
name: skill-semantic-reconcile
description: >
  Internal procedure invoked by `/context-compile` and `/context-drop`; not a user command. Consumes only
  `context reconcile prepare` output, judges semantic relation/action for each
  item, and emits a schema_version 1.0 semantic decision document for
  `context reconcile review`; apply consumes the current workflow's ready review
  artifact.
tools:
  - Bash
---

# skill-semantic-reconcile — decide Section reconciliation

Judge duplicate, merge, conflict, reanchor, and unsupported cases from the
CLI-prepared context. Emit decisions only; the CLI performs every write.

## TL;DR — Non-negotiables

- Input is only the full `context reconcile prepare` payload. Do not Read, Glob, Grep, or Write workspace `raw/`, `knowledge/`, `archive/`, or `decisions/`.
- Compact prepare summaries and `--view issues` payloads are inspection aids, not enough for semantic decisions. If the caller provided compact `context compile --draft ... --prepare` stdout, use its `workflow_payload.digest` and `scope_id` to load the full payload with `context workflow show --payload prepare --scope <scope-id> --digest <digest> --unwrap --format json` before deciding.
- Do not use Python, Node.js, shell, or other ad-hoc scripts to preprocess, filter, summarize, or inspect ReconcileContext. Consume the prepared context and review output directly; temporary files are only CLI input/output handoff points.
- Output exactly one YAML or JSON document with `schema_version: "1.0"` and `decisions[]`.
- Source refs, Section kinds, mount rules, and verify terms follow the CLI schema, prepare payload, and verify output.
- Use canonical relations: `exact_duplicate`, `strong_equivalent`, `near_duplicate`, `complement`, `supersedes`, `conflicts`, `reanchor`, `unsupported`, `keep_separate`, `ask_user`.
- Use canonical actions: `duplicate_skip`, `merge_update`, `supersede`, `reanchor`, `remove_unsupported`, `keep_separate`, `split_then_reanchor`, `omit`, `ask_user`.
- If prepare returns `items: []`, no semantic decision is needed; the caller may skip review/apply or pass `decisions: []` as an explicit no-op. If items exist and one includes `default_decision`, accepting it still requires one compact decision object for that exact `item_id` with `accept_default: true` and optional `decided_by` / `rationale`; `context reconcile review` hydrates the prepared `target` and `proposed` fields. Do not send `decisions: []` to accept defaults. `--accept-safe-defaults` only auto-accepts mechanically safe no-candidate supported writes and reviewed-no-write skips; when review is required, accept an appropriate complement/keep_separate default with `{ item_id, accept_default: true }` instead of echoing the full object. If you change the action, include the fields required by the table below.
- Never use `omit` as an automatic escape hatch. If an item looks redundant, low-value, or non-knowledge, run the Scope Review pass below first. If it is still unclear, emit `ask_user`; only a user-confirmed no-write outcome may become `action: omit` with `decided_by: user`.
- `no-op` is not a decision action. For unchanged refresh items, emit no decision or `duplicate_skip`. For compile draft `skip` items that already carry a `source_ref`, the CLI may produce a safe reviewed-no-write default; accept it with `accept_default: true` or `--accept-safe-defaults` instead of asking the user.
- Never expose `src-N`, Section ids, or source refs as the user-facing choice. They may appear only in the structured payload.
- `merge_update` is legal only when the final Section content is supported by one valid `source_ref`; otherwise use `keep_separate`, `split_then_reanchor`, or `ask_user`.
- Unresolved conflicts and low-confidence support questions must be `action: ask_user`.
- `context reconcile review` may return `support_confirmation` for a weakly supported `keep_separate`. Ask the user. If review provides the same `group_key` on several ordinary summary/compression questions, group them into one compact confirmation; do not group missing hard facts, new facts, or different evidence boundaries. If the user confirms, emit the same final write actions with `decided_by: user`; do not apply an `ask_user` decision.
- Auto mode, long-running authorization, or permission to proceed is not user confirmation. Never use it as a reason to write `decided_by: user`.
- If review returns `context-only-leakage-high`, stop before apply and follow its `agent_hints[]`: use `rewrite_with_owned_basis` only when owned or shared-primary citation evidence can support the same claim, `skip_for_node` when no citation-eligible basis exists and the claim is not core to that Node, or `pending_ownership_challenge` when a context-only or secondary shared block should be upgraded into owned/shared-primary evidence.
- The caller applies a ready review by running plain `context reconcile apply` against the current workflow scope. Apply has no input-file path; do not extract `apply_document` with scripts.
- Stable output: preserve prepared item order, keep decision object fields in the documented order, omit empty optional fields, and do not add current timestamps, random ids, storage paths, or host absolute paths. The fixed protocol and action table come first; only the prepared context should vary between repeated review calls.

<reference>

## Decision Shape

When accepting a prepared `default_decision`, this compact form is valid. Repeat
one entry per accepted `item_id`; an empty `decisions: []` document is only a
no-op when prepare returned zero items and does not accept defaults.

```yaml
schema_version: "1.0"
decisions:
  - item_id: claim-001
    accept_default: true
```

For a changed action or a hand-authored decision, emit the full shape:

```yaml
schema_version: "1.0"
decisions:
  - item_id: claim-001
    relation: near_duplicate
    action: merge_update
    target:
      node: payment-runtime
      section_id: section-3
    proposed:
      content: "Runtime isolation uses sandboxing to avoid state pollution."
      confidence: confirmed
      source_ref: "src-2#runtime L12-14@7a6f4c9d2e10"
    rationale: "The new evidence clarifies the same claim."
```

## Action Rules

| action | Required fields | Validation |
|---|---|---|
| `duplicate_skip` | `target` | Exact duplicate or already-applied no-op only. |
| `merge_update` | `target`, `proposed.content`, `proposed.source_ref`, `proposed.detail` when present in prepare | Final content must be supported by cited evidence; `proposed.kind`, when present, must match target kind. |
| `supersede` | `target`, `proposed.kind`, `proposed.content`, `proposed.source_ref`, `proposed.detail` when present in prepare | New Section claim must be supported by cited evidence. |
| `reanchor` | `target`, `proposed.source_ref`, `proposed.confidence` | Use only when target content is still supported by the new source. |
| `remove_unsupported` | `target` | Use when no active source supports the target claim in this mode. |
| `keep_separate` | `target`, `proposed.kind`, `proposed.content`, `proposed.source_ref`, `proposed.detail` when present in prepare | New orthogonal claim must be supported by cited evidence. Weak support is allowed only after explicit user confirmation (`decided_by: user`). |
| `split_then_reanchor` | `target`, `proposed.sections[]` with each Section carrying `kind`, `content`, `source_ref`, and `detail` when present in prepare | Each split Section must be independently supported by its cited evidence. |
| `omit` | `target`, `rationale`, `decided_by: user` | User-confirmed no-write result after broader scope review and user confirmation. Never emit as an automatic decision. Do not use for conflicts, unsupported evidence, reanchor/drop cases, or schema/source_ref failures. |
| `ask_user` | `user_confirmation.required: true` | Use only when business meaning or support cannot be decided from prepared evidence. |

For `merge_update`, `supersede`, `keep_separate`, and
`split_then_reanchor`, the final Section content must be supported by the cited
evidence in `proposed.source_ref` / `proposed.source_refs`. Final executable decisions must
include `proposed.source_ref`; review can hydrate a missing `source_ref` from
the current prepare item only when the decision is still the same prepared
claim. If you changed the content, kind, or evidence selection, rerun
`context reconcile prepare` instead of reusing an old prepare file. Content
should retain the raw evidence's key domain terms,
numbers, code literals, and named entities. Do not introduce acronyms,
abbreviations, translations, or aliases that the cited evidence does not
contain or define; use the raw wording, split the claim, or ask the user instead.
Do not turn sparse raw evidence into a broad summary, and do not cite a title, `Relations`, `Parent`,
`Children`, or `Related` navigation line as the only support for a substantive
claim.

Preserve prepared `proposed.detail` exactly when it is present. `detail` carries
long-form prose, examples, and code blocks; dropping it silently loses
knowledge. If you intentionally want to remove detail from an existing Section,
emit `detail: null` only on an update-style decision where that clearing is the
chosen outcome.

If review returns `example_detail_preservation`, the cited example evidence
contains a command / config / code fence that was not preserved in
`proposed.detail`. Prefer regenerating the decision with the relevant fenced
block in `proposed.detail`; only keep a prose-only example summary after asking
the user and marking the final decision `decided_by: user`. Auto mode or
permission to continue is not that confirmation.

The support gate exists to prevent orphan claims and false evidence links, not
to optimize retrieval. Prefer preserving a precise raw-backed claim over
rewriting content into a smoother summary. If a useful reader summary would
combine adjacent evidence, first broaden `proposed.source_ref` so the cited
range covers every sentence. If one range cannot honestly support the final
claim, split the claim or ask the user instead of forcing it into an incorrect
`source_ref`.

Prepared items may include `source_support.evidence_block_source_ref`,
`source_support.evidence_block_line_range`, and
`source_support.evidence_block_locator_id`, plus optional
`source_support.evidence_block_candidates[]`. These are repair hints for
evidence boundaries, not automatic permission to broaden. Use the block-level
`source_ref` only when that whole block honestly supports the final claim, then
rerun `context reconcile review`; review revalidates the changed range against
the workspace raw before apply. If a proposed summary actually combines several
candidate blocks and no single range honestly supports every sentence, split it
into separately supported claims instead of keeping one unsupported summary.

Prepared compile items may include `temporal_prior`, proposed
`source_captured_at`, and candidate `source_captured_at` /
`last_reconciled_at` / `temporal_disposition`. Treat these as review priors
only. They can explain why an older candidate may be stale relative to the new
evidence, but they do not change `default_decision` and they are never enough
to auto-supersede or auto-merge. If you accept or override a temporal prior,
state the business reason in `rationale`; do not copy temporal fields into the
executable `proposed` patch.

Weak support means hard facts match but the ordinary lexical overlap is low.
It is acceptable only for a user-confirmed `keep_separate` summary. It is not
acceptable for `merge_update`, `supersede`, `reanchor`, or
`split_then_reanchor`, because those actions overwrite, replace, or move an
existing evidence boundary. When review asks `support_confirmation`, present
the business claim and cited evidence to the user. If questions share the same
review `group_key`, you may ask one compact grouped question; otherwise ask
separately. If confirmed, regenerate the same executable decision with
`decided_by: user`; if not confirmed, choose stricter evidence or leave an
`ask_user` item unresolved and stop before apply. User confirmation only
permits weak support; it does not permit unsupported evidence or missing hard
facts. Auto mode or permission to continue is not user confirmation.

`decided_by` is a top-level decision field, not a `proposed` field:

```yaml
schema_version: "1.0"
decisions:
  - item_id: claim-008
    relation: complement
    action: keep_separate
    decided_by: user
    target:
      node: runtime-kit
    proposed:
      kind: example
      content: "The host app maps remote modules through the runtime config."
      source_ref: "src-1#example L32-40@7a6f4c9d2e10"
```

Final executable decisions must not carry `user_confirmation.required: true`.
Use that flag only on `action: ask_user` items that still require user input.

If you are tempted to omit an item, do not emit `omit` immediately. First run a
Scope Review pass over the full prepared context and the current draft
decisions:

- If the item is covered by another decision in the same batch, convert it to a
  precise executable action such as `duplicate_skip` and explain the covered-by
  item in `rationale`.
- If the item should be merged into another write action, revise that write
  action instead of dropping the item silently.
- If the item is low-value/non-knowledge but you cannot prove that from the
  prepared context, emit `ask_user` with `question_type: omit_confirmation` and
  a business-language prompt.
- If several items look low-value or the Node boundary/draft scope looks wrong,
  emit `ask_user` with `question_type: scope_review_required` and stop before
  apply.
- Only after the user confirms a no-write outcome may you emit `action: omit`
  with `decided_by: user`. `omit` is not recorded in the semantic ledger.

`remove_unsupported` has mode-specific write behavior. In compile/refresh
apply it deprecates the target Section so the unsupported claim remains visible
as inactive history. In drop apply it physically removes the Section from active
knowledge after the CLI-managed archive captures the pre-drop snapshot. Use the
same action only when this mode-specific outcome is intended.

</reference>

<procedures>

### Step 1 — Consume Prepared Context

Use the caller-provided `context reconcile prepare` output. For each item,
compare `proposed`, `candidates`, `previous_decisions`, and `evidence`.

### Step 2 — Reuse Stable Priors

If `previous_decisions[]` shows the same boundary and the prepared item still
matches, emit the same final action. If the target changed, treat the previous
decision as a prior only and continue judging.

### Step 3 — Decide Relation And Action

Classify each item:

- Exact same claim already active -> `exact_duplicate` + `duplicate_skip`.
- Same claim with a raw-supported correction or refinement from one supporting source -> `strong_equivalent` or `near_duplicate` + `merge_update`.
- Additional but separate boundary -> `complement` + `keep_separate`.
- Item appears redundant or not worth writing -> run Scope Review first; if still unresolved, `ask_user` (`omit_confirmation` or `scope_review_required`). Use `omit` only after user confirmation.
- New material replaces old rule -> `supersedes` + `supersede`.
- Direct contradiction -> `conflicts` + `ask_user`.
- Drop item still fully supported elsewhere -> `reanchor` + `reanchor`.
- Drop item partly supported -> `reanchor` + `split_then_reanchor`.
- No surviving support -> `unsupported` + `remove_unsupported`.
- Evidence is close but not enough -> `ask_user`; for `keep_separate`, review may turn this into `support_confirmation` and require explicit user confirmation before apply.

### Step 4 — Emit Decisions

Emit only executable final decisions plus unresolved `ask_user` questions.
Do not include prose outside the document.

If the latest review rejected the batch with `context-only-leakage-high`, do
not convert it into a generic `ask_user`. Regenerate the affected decision using
one of the review hint's explicit repair options and cited item ids, then rerun
`context reconcile review`. A context-only block may provide background only; it
must not become the support basis for a written Section unless ownership is
challenged and upgraded by the workflow.

### Step 5 — Self-verify

- [ ] Every decision uses canonical relation/action values. If not, **Step 3**.
- [ ] No `no-op` action appears. If not, **Step 3**.
- [ ] Every write action has the required fields from [Action Rules](#action-rules). If not, **Step 4**.
- [ ] No automatic `omit` appears. If any item is being skipped without proof, run Scope Review or ask the user.
- [ ] Prepared `proposed.detail` is preserved on executable write decisions. If not, **Step 4**.
- [ ] `decided_by: user` appears only after the user explicitly confirmed a review question. If not, remove it and ask the user.
- [ ] No workspace files were read or written directly. If violated, restart from **Step 1**.

</procedures>
