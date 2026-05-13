---
name: skill-semantic-reconcile
description: >
  Packaged skill used by `/context-drop`, refresh/non-compile reconcile flows,
  and compile scope-review fallback; not a user command. Ordinary compile
  prepare judgment uses `skill-compile-judge`. This skill consumes only
  `context reconcile prepare` output, judges semantic relation/action for each item,
  and emits a schema_version 1.0 semantic decision document for `context reconcile review`;
  apply consumes the current workflow's ready review artifact.
tools:
  - Bash
---

# skill-semantic-reconcile — decide Section reconciliation

Judge duplicate, merge, conflict, reanchor, and unsupported cases for refresh,
drop, non-compile reconcile, or compile scope-review fallback. Emit decisions
only; the CLI performs every write.

## TL;DR — Non-negotiables

- Input is the full `context reconcile prepare` payload. If the caller handed you a compact prepare summary or `--view issues` payload, load the full payload first with `context workflow show --payload prepare --unwrap --format json` (add `--digest` only as an explicit stale guard). Never `grep` / `sed` / `jq` / `cat` / `head` workflow scratch files or `--format json` stdout to recover prepare fields, and do not Read / Glob / Grep / Write workspace `raw/` / `knowledge/` / `archive/` / `decisions/` — the prepare payload and review output are the only inputs.
- Ordinary compile prepare judgment belongs to `skill-compile-judge`. Use this skill for refresh/drop/non-compile reconcile, or when compile review asks for scope/omit/user-confirmation reasoning that is outside the judge handoff.
- Output: one YAML or JSON document conforming to `context schema semantic-decisions --format yaml`. The schema defines canonical `relation` and `action` enums and the per-action required fields; do not memorise the enum list from this skill.
- Accept a prepared `default_decision` with the compact form `{ item_id, accept_default: true }` (optionally `decided_by` / `rationale`); the CLI hydrates `target` / `proposed`. Empty `decisions: []` means "no items in prepare," not "accept all defaults." Without `--accept-safe-defaults`, emit one compact accept entry per safe default you intend to accept. With `--accept-safe-defaults`, the CLI auto-accepts mechanically safe no-candidate supported writes and reviewed-no-write skips, so emit only the manual decisions that still need judgment.
- Every `merge_update` / `supersede` / `keep_separate` / `split_then_reanchor` write must be supported by **one** valid `proposed.source_ref` covering the final content. Preserve raw evidence's domain terms, numbers, code literals, and named entities; do not introduce acronyms, translations, or aliases the cited evidence does not define. Do not cite a title, `Relations` / `Parent` / `Children` / `Related` navigation line as the sole support for a substantive claim.
- Unresolved conflicts and low-confidence support → `action: ask_user`. Never expose `src-N`, Section ids, or source refs as the user-facing choice; they belong only in the structured payload.
- `decided_by: user` only after a specific recent user message answering the specific question for the specific item. Auto mode, blanket "continue," and long-running permissions are **not** user confirmation. Never mark yourself.
- `omit` is never an automatic decision. If an item looks redundant or low-value, follow the Scope Review pass in [references/scope-review-and-omit.md](references/scope-review-and-omit.md); only a user-confirmed no-write outcome may become `action: omit` with `decided_by: user`.
- `apply` consumes the ready review artifact for the current workflow scope: run plain `context reconcile apply`. There is no input file; do not extract `apply_document` with scripts.
- Stable output: preserve prepared item order; the CLI rejects unknown fields (timestamps, random ids, storage paths, host absolute paths) and canonicalises stored payloads. Fixed rules and schema come from this skill; only the prepared context varies between repeated review calls.

## Edge cases — consult references when:

| Condition | Reference |
|---|---|
| `prepare.mode` is `drop` or `refresh` (covers `remove_unsupported` mode semantics, `reanchor`, `split_then_reanchor`) | [references/mode-semantics.md](references/mode-semantics.md) |
| review returned `support_confirmation`, `omit_confirmation`, `scope_review_required`, or any `ask_user` you need to upgrade to an executable decision | [references/user-confirmation.md](references/user-confirmation.md) |
| review returned `agent_hints[]` with `code: "context-only-leakage-high"` | [references/leakage-and-ownership.md](references/leakage-and-ownership.md) |
| items carry `temporal_prior` / `source_captured_at` / `temporal_disposition`, `source_support.evidence_block_*`, `proposed.detail`, or review returned `example_detail_preservation` | [references/temporal-and-evidence.md](references/temporal-and-evidence.md) |
| considering `action: omit`, or items look redundant / low-value / scope-wrong | [references/scope-review-and-omit.md](references/scope-review-and-omit.md) |

If none of the above hold, you are on this skill's main path: refresh/drop/non-compile reconcile, or compile scope-review fallback with no special review-time signals. Ordinary compile prepare relation/support judgment remains `skill-compile-judge`.

<reference>

## Decision Shape

Accept a prepared `default_decision` with the compact form:

```yaml
schema_version: "1.0"
decisions:
  - item_id: claim-001
    accept_default: true
```

For a changed action or hand-authored decision, emit the full shape with the action's required fields (see Action Rules below):

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

`decided_by` is a top-level decision field, not a `proposed` sub-field. Final executable decisions must not carry `user_confirmation.required: true` — that flag belongs only on `action: ask_user` items still awaiting input.

## Action Rules — main path

Edge-case actions (`reanchor`, `split_then_reanchor`, `remove_unsupported`, `omit`) and their required fields live in the matching reference; consult them when triggered.

| action | Required fields | Validation |
|---|---|---|
| `duplicate_skip` | `target` | Exact duplicate or already-applied no-op only. |
| `merge_update` | `target`, `proposed.content`, `proposed.source_ref`, `proposed.detail` when present in prepare | Final content must be supported by cited evidence; `proposed.kind`, when present, must match target kind. |
| `supersede` | `target`, `proposed.kind`, `proposed.content`, `proposed.source_ref`, `proposed.detail` when present in prepare | New Section claim must be supported by cited evidence. |
| `keep_separate` | `target`, `proposed.kind`, `proposed.content`, `proposed.source_ref`, `proposed.detail` when present in prepare | New orthogonal claim must be supported by cited evidence. Weak support is allowed only after explicit user confirmation (`decided_by: user`). |
| `ask_user` | `user_confirmation.required: true` | Use when business meaning or support cannot be decided from prepared evidence. |

Source-support gate: if the proposed claim cannot honestly point at one range covering every sentence, split the claim or ask the user instead of forcing it into an incorrect `source_ref`. If a useful reader summary would combine adjacent evidence, first broaden `proposed.source_ref` so the cited range covers every sentence; if that broadening would require unrelated content, split. See [references/temporal-and-evidence.md](references/temporal-and-evidence.md) for evidence-block repair hints.

</reference>

<procedures>

### Step 1 — Consume Prepared Context

Use the caller-provided `context reconcile prepare` payload. For each item, compare `proposed`, `candidates`, `previous_decisions`, and `evidence`.

If `prepare.mode` is `drop` or `refresh`, or any item carries the special signals listed in the routing table above, read the relevant reference **before** classifying — those references explain how the corresponding conditions modify Step 2.

If prepare returns `items: []`, no decision is needed; the caller may skip review/apply or pass `decisions: []` as an explicit no-op.

If `previous_decisions[]` shows the same boundary and the prepared item still matches, emit the same final action. If the target changed, treat the previous decision as a prior only and continue judging.

### Step 2 — Decide Relation And Action

Classify each item against the prepared evidence:

- Exact same claim already active → `exact_duplicate` + `duplicate_skip`.
- Same claim with a raw-supported correction or refinement from one supporting source → `strong_equivalent` or `near_duplicate` + `merge_update`.
- Additional but separate boundary → `complement` + `keep_separate`.
- New material replaces old rule → `supersedes` + `supersede`.
- Direct contradiction → `conflicts` + `ask_user`.
- Evidence is close but not enough → `ask_user`; for `keep_separate`, review may turn this into `support_confirmation` (see [references/user-confirmation.md](references/user-confirmation.md)).
- Item appears redundant or not worth writing → run the Scope Review pass in [references/scope-review-and-omit.md](references/scope-review-and-omit.md); never auto-`omit`.

Drop-mode-only branches (`reanchor`, `split_then_reanchor`, `remove_unsupported`) live in [references/mode-semantics.md](references/mode-semantics.md).

### Step 3 — Emit Decisions

Emit one document with `schema_version: "1.0"` and `decisions[]`. Include only executable final decisions plus unresolved `ask_user` questions. Do not include prose outside the document.

If the latest review rejected the batch with `context-only-leakage-high`, do not convert it into a generic `ask_user`. Follow [references/leakage-and-ownership.md](references/leakage-and-ownership.md): regenerate the affected decision using one of the review hint's explicit repair options and cited item ids, then rerun `context reconcile review`.

### Step 4 — Self-verify

- [ ] Every decision uses canonical `relation` / `action` values per `context schema semantic-decisions`. If not, return to **Step 2**.
- [ ] Every write action carries the required fields from Action Rules (or, for edge-case actions, the rules in the matching reference). If not, **Step 3**.
- [ ] `decided_by: user` corresponds to a specific recent user message answering this specific question for this specific item. If not, downgrade to `ask_user`.
- [ ] No `action: omit` was emitted without `decided_by: user` and a business `rationale`. If any, run Scope Review per [references/scope-review-and-omit.md](references/scope-review-and-omit.md).
- [ ] If any edge case condition applies (drop/refresh mode, review confirmation request, leakage, temporal/evidence signals, omit), the relevant reference's Self-verify items were also satisfied.
- [ ] No workspace files were read or written directly; no `--format json` stdout was sliced with shell tools. If violated, restart from **Step 1**.

</procedures>
