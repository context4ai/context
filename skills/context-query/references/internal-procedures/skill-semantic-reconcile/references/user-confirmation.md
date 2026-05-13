# User confirmation paths

Consult this reference when `context reconcile review` returns any of:

- `support_confirmation` (weak support questions)
- `omit_confirmation` (no-write outcome under Scope Review)
- `scope_review_required` (item set looks miscoped)
- any other `ask_user` question that needs user input before apply

For runs where review emits no questions, ignore this file.

## What counts as "user confirmation"

Only **explicit user reply to a question your agent asked**. The following are **not** confirmation:

- Auto mode being active
- A blanket "continue" / "yes go ahead" earlier in the session
- Permission to run shell commands
- A previous decision applied with `decided_by: user` for a different item

If you cannot point at a specific user message answering the specific question for this specific item, **do not emit `decided_by: user`**.

## Weak support handling

A prepare item is "weakly supported" when hard facts match between `proposed` and `evidence`, but lexical overlap is low. `context reconcile review` flags these and may return `support_confirmation`.

Rules:

- Weak support is **only** acceptable on `keep_separate`. It is **not** acceptable on `merge_update`, `supersede`, `reanchor`, or `split_then_reanchor` — those overwrite, replace, or move an existing evidence boundary and need stronger backing.
- When review asks `support_confirmation`, present the business claim and cited evidence to the user in business language. Do not expose `src-N` / Section ids / source refs as the user-facing choice.
- If the user confirms, regenerate the same executable decision with `decided_by: user` and rerun review. If they decline, choose stricter evidence, broaden the cited range honestly, or leave the item as `ask_user` and stop before apply.

## Grouping `support_confirmation`

When review provides the **same `group_key`** on several questions that are all ordinary summary / compression checks, group them into one compact confirmation:

- One question to the user listing all grouped claims and their cited evidence.
- If confirmed, emit `decided_by: user` on each grouped decision.

**Do not group**:

- Questions that introduce new facts (the user is making a fact-level call, not a wording call).
- Questions where one item has missing hard facts that the others have.
- Questions whose evidence boundaries differ (different sources / different blocks).

When in doubt, ask separately.

## `omit_confirmation` and `scope_review_required`

These are escape hatches from the omit gate. See `references/scope-review-and-omit.md` for when to emit them.

When review returns either as an unresolved `ask_user` item, ask the user, capture the answer, and act:

- User confirms no-write → final decision is `action: omit` with `decided_by: user` and a business `rationale`. `omit` is not recorded in the semantic ledger.
- User declines → revise the item to a concrete write action or to `ask_user` with a sharper question.

## Final-decision invariants

After user confirmation:

- `decided_by` is a **top-level** decision field, not a `proposed` sub-field.
- Final executable decisions must not carry `user_confirmation.required: true`. That flag belongs only on `action: ask_user` items that still need input.
- User confirmation permits weak support and omit. It does **not** permit unsupported evidence, missing hard facts, or contradictory claims — those still need stricter evidence or stay `ask_user`.

## How this slots into the main procedure

- **Step 3 — Decide**: keep `support_confirmation` / `omit_confirmation` / `scope_review_required` candidates as `ask_user` with the right `question_type` until the user replies.
- **Step 4 — Emit**: only after a user reply may you upgrade an `ask_user` to an executable decision with `decided_by: user`.
- **Step 5 — Self-verify**: every `decided_by: user` corresponds to a specific recent user message; if not, downgrade back to `ask_user`.
