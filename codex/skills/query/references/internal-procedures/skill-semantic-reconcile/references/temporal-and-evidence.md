# Temporal priors and evidence boundary signals

Consult this reference when prepare items carry **any** of:

- `temporal_prior` / `proposed.source_captured_at` / candidate `source_captured_at` / `last_reconciled_at` / `temporal_disposition`
- `source_support.evidence_block_candidates[]` or `source_support.evidence_block_*` repair hints
- `proposed.detail` with command / config / code fence content
- `agent_hints[]` with `code: "example_detail_preservation"`

For prepare items that have none of the above, ignore this file.

## Temporal priors — review-only signals

Compile prepare items may include:

- `proposed.source_captured_at` — when the new evidence was captured.
- Each candidate's `source_captured_at`, `last_reconciled_at`, and `temporal_disposition` (`stale` / `recent` / `concurrent`).
- A top-level `temporal_prior` summary.

Treat these as **priors that explain context, never as license to act**:

- They can justify why an older candidate may be stale relative to new evidence.
- They **do not** change `default_decision`.
- They are **never** enough on their own to auto-supersede or auto-merge.

If you accept or override a temporal prior, state the business reason in `rationale`. **Do not copy temporal fields into the executable `proposed` patch** — the CLI strips them.

## Evidence boundary repair hints

When `source_support.verdict` is `weak` or `unsupported` and the prepare item contains:

- `source_support.evidence_block_source_ref` — the canonical block-level source_ref the cited claim falls in.
- `source_support.evidence_block_line_range` — the block's line range.
- `source_support.evidence_block_locator_id` — the block's locator id.
- `source_support.evidence_block_candidates[]` — adjacent candidate blocks (optional).

These are **repair hints**, not automatic broadening permission. Rules:

1. Use the block-level `source_ref` **only when the whole block honestly supports the final claim**. Rerun `context reconcile review` after broadening — review revalidates the new range against workspace raw before apply.
2. If the proposed summary actually combines several candidate blocks and **no single range honestly supports every sentence**, split the claim into separately supported decisions instead of forcing one unsupported summary through.
3. Do not invent ranges that include unrelated content just to get the verdict to pass.

The support gate exists to prevent orphan claims and false evidence links, not to optimize retrieval. Prefer preserving a precise raw-backed claim over rewriting content into a smoother summary.

## `proposed.detail` preservation

When the prepare item carries `proposed.detail`, treat it as load-bearing:

- `detail` carries long-form prose, examples, and code blocks.
- Dropping `detail` silently loses knowledge.
- Preserve it **exactly** on executable write decisions (`merge_update`, `supersede.new`, `keep_separate`, `split_then_reanchor` sub-Sections).
- The only legitimate way to clear `detail` is an update-style decision that explicitly emits `detail: null` as the chosen outcome.

## `example_detail_preservation` repair

If review returns `example_detail_preservation`, the cited example evidence contains a command / config / code fence that did **not** appear in `proposed.detail`. Repair:

- **Preferred**: regenerate the decision with the relevant fenced block included in `proposed.detail` (preserve language, fences, and exact code).
- **Fallback only after user confirmation**: keep a prose-only example summary, mark the final decision `decided_by: user` per `references/user-confirmation.md`. Auto mode is not user confirmation.

## How this slots into the main procedure

- **Step 1 — Consume**: scan prepare items for the signal fields above; flag affected items for the relevant repair path.
- **Step 3 — Decide**: temporal priors inform `rationale` but never the action choice; evidence-block hints may justify broadening the cited range.
- **Step 4 — Emit**: rerun `context reconcile review` after broadening ranges or restoring `detail`; only then proceed to apply.
- **Step 5 — Self-verify**: no executable write strips a prepared `detail`; no temporal field leaks into `proposed`; every broadened `source_ref` has been re-reviewed.
