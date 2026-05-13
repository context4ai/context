# Scope Review and `omit` discipline

Consult this reference when **you are tempted to emit `action: omit`**, or when an item looks redundant / low-value / non-knowledge. For runs without such items, ignore this file.

## Core rule

`omit` is **never an automatic decision**. It records a no-write outcome **after** broader scope review and **after** explicit user confirmation. Emitting `omit` without both is a protocol violation.

`omit` is also **not the right tool** for:

- Conflicts → use `ask_user`.
- Unsupported evidence → use `unsupported` + `remove_unsupported` (mode-aware; see `references/mode-semantics.md`).
- Reanchor/drop cases → use `reanchor` or `split_then_reanchor`.
- Schema / source_ref failures → fix the decision, do not omit.

`omit` is **not recorded in the semantic ledger**. There is no audit trail; this is why the confirmation gate exists.

## Scope Review pass

Before emitting `omit` or `ask_user` with `question_type: omit_confirmation`, run this pass over the full prepared context and the current draft decisions:

1. **Covered-by check** — is the item already covered by another decision in the same batch?
   - Yes → convert it to a precise executable action such as `duplicate_skip` and explain the covered-by item in `rationale`. Do not omit.

2. **Mergeable check** — should this item's content be merged into another write action?
   - Yes → revise the other write action to incorporate this evidence. Drop the standalone item only after the merged action survives review. Do not omit silently.

3. **Provable low-value check** — can you prove from the prepared context that the item is low-value / non-knowledge?
   - Yes (prepared context contains the proof) → emit `ask_user` with `question_type: omit_confirmation` and a business-language prompt.
   - No (you only have a hunch) → emit `ask_user` with `question_type: omit_confirmation` and present the claim + evidence so the user can judge.

4. **Scope-wide miscope check** — do several items look low-value, or does the Node boundary / draft scope look wrong?
   - Yes → emit `ask_user` with `question_type: scope_review_required` and **stop before apply**. Do not paper over a scope problem with a series of `omit` decisions.

5. **User-confirmed no-write** — only after the user has explicitly answered the `omit_confirmation` or `scope_review_required` question saying "do not write," may you emit:

   ```yaml
   - item_id: claim-007
     relation: keep_separate    # or whatever the prepared relation was
     action: omit
     target:
       node: ...
     decided_by: user
     rationale: "<business reason from the user reply>"
   ```

   `decided_by: user` must reflect a specific recent user message answering this specific question (see `references/user-confirmation.md`).

## Common anti-patterns

- Emitting `omit` because the item "looks redundant" without running Scope Review.
- Emitting `omit` because review returned `ask_user` and you want to clear the queue.
- Treating auto mode / earlier "continue" as user confirmation.
- Using `omit` to dodge a `remove_unsupported` decision in drop mode (the physical-remove behavior is the **point** of drop).

## How this slots into the main procedure

- **Step 3 — Decide**: when tempted to skip an item, treat that temptation as a signal to run Scope Review **before** writing the decision.
- **Step 4 — Emit**: only emit `omit` when a specific user reply confirms the no-write outcome; otherwise emit `ask_user`.
- **Step 5 — Self-verify**: no `action: omit` appears without `decided_by: user` and a `rationale` that names the business reason.
