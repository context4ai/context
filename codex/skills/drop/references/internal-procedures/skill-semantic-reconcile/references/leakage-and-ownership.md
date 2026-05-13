# Context-only leakage and ownership upgrades

Consult this reference when `context reconcile review` returns `agent_hints[]` with `code: "context-only-leakage-high"`. For runs without that hint, ignore this file.

## What the hint means

A decision's `proposed.source_ref` cites a block that is **`context_only`** for this Node, or a **secondary-shared** block (the Node is in `owners[]` but not `primary_owner`). Those blocks may inform context but cannot be the support basis for a written Section — that breaks the ownership boundary set during align finalize.

`context-only-leakage-high` is a **hard rejection**. Do not convert it into a generic `ask_user` and do not retry the same decision unchanged.

## Three repair options

The review hint names which one applies per item. Pick exactly one:

| Hint repair option | When | What to emit |
|---|---|---|
| `rewrite_with_owned_basis` | An owned or shared-primary citation block in the same prepare item supports the same claim | Regenerate the decision citing the owned/primary block; resubmit to `context reconcile review`. |
| `skip_for_node` | No citation-eligible owned/primary evidence exists in this prepare batch, and the claim is not load-bearing for the Node | Emit `action: ask_user` with `question_type: skip_for_node_confirmation` and the cited evidence; only after user confirms, emit `duplicate_skip` or `omit` (`decided_by: user`). |
| `pending_ownership_challenge` | The context-only/secondary-shared block contains facts the Node legitimately needs; align must upgrade ownership | Stop the reconcile loop; emit the challenge through the compile draft side (see `plugin/skills/skill-compile-draft/references/structural-challenges.md`) and let the align workflow resolve the split. |

## What not to do

- Do not paraphrase the offending block into different wording while still citing it — the CLI hashes the cited block, not the prose, so paraphrasing does not lift the leakage flag.
- Do not promote the block through `request_full_text` — that command exposes visible evidence text for inspection but does not change citation eligibility.
- Do not silently `duplicate_skip` to make the warning disappear; the hint may indicate a real evidence gap.
- Do not regenerate the decision with a different `target` to dodge the rule.

## How this slots into the main procedure

- **Step 4 — Emit**: when review returns `context-only-leakage-high`, treat the affected items as not-yet-decided. Apply the chosen repair option per item, then rerun `context reconcile review` before considering apply.
- **Step 5 — Self-verify**: no `proposed.source_ref` points at a block whose ownership role for the target Node is `context_only` or secondary-shared. The CLI re-checks at apply time, but catching it here saves a round trip.
