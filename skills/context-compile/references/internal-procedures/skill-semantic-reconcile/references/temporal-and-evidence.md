# Temporal priors and evidence boundary pointers

Consult this reference when prepare items carry **any** of:

- `temporal_prior` / `proposed.source_captured_at` / candidate `source_captured_at` / `last_reconciled_at` / `temporal_disposition`
- raw/source_ref boundary diagnostics or nearby source_ref pointers
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

## Evidence boundary repair

When review reports that the cited source_ref is invalid, stale, too narrow, or otherwise cannot support the proposed write, use only CLI-rendered evidence text and canonical source_ref values:

- canonical `source_ref` / `source_refs[]` values from the current view
- block ids and line ranges surfaced by the CLI
- nearby source_ref pointers included in diagnostics

These are **repair hints**, not automatic broadening permission. Rules:

1. Use a broader `source_ref` **only when the whole range honestly supports the final claim**. Rerun `context reconcile review` after broadening — review revalidates the new range against workspace raw before apply.
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

## How this slots into the main procedure

- **Step 1 — Consume**: scan prepare items for the signal fields above; flag affected items for the relevant repair path.
- **Step 3 — Decide**: temporal priors inform `rationale` but never the action choice; evidence-block hints may justify broadening the cited range.
- **Step 4 — Emit**: rerun `context reconcile review` after broadening ranges; only then proceed to apply.
- **Step 5 — Self-verify**: no executable write strips prepared `content` or `summary`; no temporal field leaks into `proposed`; every broadened `source_ref` has been re-reviewed.
