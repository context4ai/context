---
id: context.semantic.compile.refresh-and-update
kind: procedure
media-type: text/markdown
applies-to:
  - update
  - replacement
  - withdrawal
  - stale
---

# Refresh and update
<!-- Context workflow semantic resource. -->

Consult this reference when **any** of the following holds:

- `existing.sections[]` is non-empty (Node already has active knowledge; this is a refresh, not a first compile).
- `incremental.status` is `unchanged` or `full-context` (non-default incremental signals).
- `incremental.locator_only_changes[]` is non-empty (locator-only deltas without content changes).

For first compile of a fresh Node with `incremental.status === "changed-only"`, skip this file.

## Incremental status handling

| `incremental.status` | What to do |
|---|---|
| `changed-only` (default) | Normal path — the main compile procedure applies as written. |
| `unchanged` | Emit exactly one `skip` action with a brief reason. Do not iterate snippets. |
| `full-context` | Draft from the full fallback. **Preserve `unknown_inputs[]` reasons** in any abort/retry explanation so the caller sees why the fallback was needed. |

The CLI may deterministically skip unchanged output or update locator-only evidence before writing. **Do not force artificial content changes to bypass fingerprint skip** — those skips are part of the protocol, not a problem to route around.

## Locator-only changes

`incremental.locator_only_changes[]` entries always carry `agent_action: "none"` and `handled_by: "compile-close"`. **Do not emit a draft action for those Sections** unless the same Section also appears in `changed_blocks[]` with a real content change.

## Reconciling with `existing.sections[]`

When `existing.sections[]` is non-empty, every section id you read here is a
potential same-section `update` target or a signal that the structure/user gate
must decide a higher-risk replacement or withdrawal. Walk the existing Sections
in order and decide:

| Raw evidence vs existing Section | op |
|---|---|
| Raw still supports the existing claim unchanged | Emit nothing (or one summarising `skip`) |
| Raw clarifies or rephrases without changing meaning | `update` — same `section-N` stays active |
| Raw changes meaning (new spec value, reversed decision) | Stop and route to user/structure review; do not emulate a replacement with `update` |
| Raw removes the supporting evidence | Stop and route to user/structure review; do not hide the previous active section with a compile no-write |

### Replacement vs `update` semantics

Replacement preserves the audit trail so readers can see that the prior policy
changed — **critical for specs / decisions / principles**. Use `update` only
for typo / wording fixes / detail additions that do not change meaning. When
meaning changes or support disappears, do not write a compile action until the
user/structure gate has chosen the intended disposition.

### Current output mechanics

- `update` keeps the same planned section identity. In the current
  `context.compile-actions.v1` shape, emit `op: "update"` with `section_id`,
  `kind` when needed, `summary` when useful, and current `source_refs[]`. Omit
  `content` so the CLI mirrors the new cited source span. If the intended update
  requires translation, compression, or reorganization, stop and return to the
  structure/user gate instead of writing reader-visible content in compile.
- Fresh replacement content is a new structure/review decision, not a current
  compile write shape. Preserve the semantic judgment in the user report or
  unresolved structure discussion and route back to the appropriate gate; do
  not invent unsupported target fields.

## Output shape (current update path)

```jsonc
{
  "schema_version": "context.compile-actions.v1",
  "view_ref": "architecture:entity/example",
  "actions": [
    {
      "op": "update",
      "section_id": "retention-policy",
      "kind": "spec",
      "summary": "...",
      "source_refs": ["file:docs/example.md#span:retention L10-14@<span-hash>"]
    }
  ]
}
```

## How this slots into the main procedure

- **Step 1 — Sanity-check**: when `existing.sections[]` is non-empty, read every section id and status before classifying snippets. When `incremental.status` is `unchanged`, short-circuit with one `skip`.
- **Step 2 — Classify**: still walk the kind priority chain for each citation-eligible snippet; the reconciliation table above governs which `op` to emit for snippets that map to an existing Section.
- **Step 5 — Self-verify**: every `update` targets a known planned section id
  from the confirmed structure. If a replacement or withdrawal judgment has no
  accepted compile action shape, stop and route back through review/align
  instead of emitting unsupported fields.
