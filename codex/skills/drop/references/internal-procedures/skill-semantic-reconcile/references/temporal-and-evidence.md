# Temporal priors and evidence boundary signals

Consult this reference when prepare items carry **any** of:

- `temporal_prior` / `proposed.source_captured_at` / candidate `source_captured_at` / `last_reconciled_at` / `temporal_disposition`
- `source_support.evidence_block_candidates[]` or `source_support.evidence_block_*` repair hints
- prepared long `proposed.content` / `proposed.summary`, especially with command / config / code fence content

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

## Long `proposed.content` / `proposed.summary` preservation

When the prepare item carries long `proposed.content` or a `proposed.summary`, treat both as load-bearing:

- `content` carries the active Section knowledge, including long-form prose, examples, URLs, tables, commands, config, and code blocks.
- `summary` is the short reader/query aid for long content.
- Dropping either field silently loses knowledge or query UX.
- Preserve prepared `content` and `summary` on executable write decisions (`merge_update`, `supersede.new`, `keep_separate`, `split_then_reanchor` sub-Sections) unless the decision intentionally rewrites the user-facing content.
- The only legitimate way to clear `summary` is an update-style decision that explicitly emits `summary: null` as the chosen outcome.

## Example content preservation advisory

If review reports that a cited example evidence contains a command / config / code fence missing from `proposed.content`, first check the CLI issue severity and next action.

- **When blocking**: regenerate the decision with the relevant fenced block included in `proposed.content` (preserve language, fences, and exact code), then rerun review.
- **When advisory/debt**: do not patch solely for formatting. Patch only if the missing command/config/code changes the user-facing meaning or the user asks for fidelity cleanup.

## How this slots into the main procedure

- **Step 1 — Consume**: scan prepare items for the signal fields above; flag affected items for the relevant repair path.
- **Step 3 — Decide**: temporal priors inform `rationale` but never the action choice; evidence-block hints may justify broadening the cited range.
- **Step 4 — Emit**: rerun `context reconcile review` after broadening ranges or restoring missing example content; only then proceed to apply.
- **Step 5 — Self-verify**: no executable write strips prepared `content` or `summary`; no temporal field leaks into `proposed`; every broadened `source_ref` has been re-reviewed.
