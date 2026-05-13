# Mode-specific semantics

Consult this reference when **`prepare.mode` is `drop` or `refresh`**. For the default `compile` mode, ignore this file and follow the main SKILL.md procedure.

## Available actions per mode

| Action | `compile` | `refresh` | `drop` | `restore` |
|---|---|---|---|---|
| `duplicate_skip` / `merge_update` / `supersede` / `keep_separate` / `ask_user` | ✓ | ✓ | (rare) | ✓ |
| `reanchor` | — | — | **drop-only** | — |
| `split_then_reanchor` | — | — | **drop-only** | — |
| `remove_unsupported` | ✓ deprecate | ✓ deprecate | **physical remove** | — |

## `remove_unsupported` — mode-dependent write behavior

The action is the same, the on-disk effect is not.

| Mode | What happens on apply |
|---|---|
| `compile` / `refresh` | Target Section's `status` flips to `deprecated`; the unsupported claim stays visible as inactive history. |
| `drop` | The Section is physically removed from active knowledge after the CLI-managed archive captures the pre-drop snapshot. |

Only emit `remove_unsupported` when this mode's outcome is the intended one. A claim that should remain visible-but-stale belongs in `compile`/`refresh`; a claim that the workspace must lose belongs in `drop`.

## `reanchor` and `split_then_reanchor` — drop-only

These appear only in drop prepare items. They handle "a Section that the drop would remove still has supporting evidence in another source."

| Item shape | Decision |
|---|---|
| Drop item still **fully** supported by surviving source | `reanchor` + `reanchor` — repoint `proposed.source_ref` at the surviving evidence, keep target unchanged. |
| Drop item **partly** supported (one fact survives, another does not) | `reanchor` + `split_then_reanchor` — split into `proposed.sections[]`, each with independent `kind` / `content` / `source_ref` / `detail`. |
| No surviving support | `unsupported` + `remove_unsupported` (physical remove on drop apply). |

`split_then_reanchor` requires each split Section to be independently supported by its own cited evidence. The CLI rejects splits where any sub-Section's `source_ref` does not cover its `content`.

## How this slots into the main procedure

- **Step 1 — Consume Prepared Context**: read `prepare.mode` first. If `drop` or `refresh`, the Step 3 classification table extends with the mode-specific rows above.
- **Step 3 — Decide Relation And Action**: for drop items, use the `reanchor` / `split_then_reanchor` / `remove_unsupported` branches from the table here rather than forcing the items into compile-mode actions.
- **Step 5 — Self-verify**: confirm no compile-mode action was emitted on a drop item (and vice versa) — the CLI rejects with a clear hint, but catching it here saves a round trip.
