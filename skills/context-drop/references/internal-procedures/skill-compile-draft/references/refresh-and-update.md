# Refresh and update

Consult this reference when **any** of the following holds:

- `existing.sections[]` is non-empty (Node already has active knowledge; this is a refresh, not a first compile).
- `incremental.status` is `unchanged` or `full-context` (non-default incremental signals).
- `incremental.locator_only_changes[]` is non-empty (locator-only deltas without content changes).

For first compile of a fresh Node with `incremental.status === "changed-only"`, skip this file.

## Incremental status handling

| `incremental.status` | What to do |
|---|---|
| `changed-only` (default) | Normal path — main SKILL.md procedure applies as written. |
| `unchanged` | Emit exactly one `skip` action with a brief reason. Do not iterate snippets. |
| `full-context` | Draft from the full fallback. **Preserve `unknown_inputs[]` reasons** in any abort/retry explanation so the caller sees why the fallback was needed. |

The CLI may deterministically skip unchanged output or update locator-only evidence before writing. **Do not force rewrites to bypass fingerprint skip** — those skips are part of the protocol, not a problem to route around.

## Locator-only changes

`incremental.locator_only_changes[]` entries always carry `agent_action: "none"` and `handled_by: "compile-close"`. **Do not emit a draft action for those Sections** unless the same Section also appears in `changed_blocks[]` with a real content change.

## Reconciling with `existing.sections[]`

When `existing.sections[]` is non-empty, every `section-N` id you read here is a potential `update` / `supersede` / `deprecate` target. Walk the existing Sections in order and decide:

| Raw evidence vs existing Section | op |
|---|---|
| Raw still supports the existing claim unchanged | Emit nothing (or one summarising `skip`) |
| Raw clarifies or rephrases without changing meaning | `update` — same `section-N` stays active |
| Raw changes meaning (new spec value, reversed decision) | `supersede` — old flips to `deprecated`; new gets fresh `section-N+k` |
| Raw removes the supporting evidence | `deprecate` with `reason` |

### `supersede` vs `update` semantics

`supersede` preserves the audit trail so readers see the prior policy — **critical for specs / decisions / principles**. Use `supersede` whenever the new statement *replaces* the old one's content; use `update` only for typo / wording fixes / detail additions that do not change meaning.

`deprecate` is for "old rule removed without replacement". It needs a `reason`.

### `update` / `supersede.new` mechanics

- `update` keeps the same `section-N` id; provide new `content` (optional `summary`, optional new `source_refs[]`) but do not include `kind` unless the kind itself is changing.
- `supersede.new` is a fresh Section; it needs `kind`, `content`, `source_refs[]`, and may carry `summary`, `refers_to_nodes[]`, and `confidence` per the same rules as `add`.
- `deprecate` only needs `target_section_id` and `reason`. Do not pass `content` or `source_refs[]`.

## Output schema (refresh ops)

```jsonc
	{
	  "actions": [
	    { "op": "update", "target_section_id": "section-3",
	      "content": "...",
	      "refers_to_nodes": null,
	      "source_refs": ["src-1#api L18-21@c0d4e5f61728"] },
	    { "op": "supersede", "target_section_id": "section-5",
	      "reason": "raw published a new retention value",
	      "new": { "kind": "spec", "content": "...",
	               "refers_to_nodes": ["..."],
	               "source_refs": ["src-1#limits L30-34@9d1e2f3a4b5c"] } },
    { "op": "deprecate", "target_section_id": "section-2", "reason": "..." }
  ]
}
```

## How this slots into the main procedure

- **Step 1 — Sanity-check**: when `existing.sections[]` is non-empty, read every `section-N` id and `status` (active vs deprecated) before classifying snippets. When `incremental.status` is `unchanged`, short-circuit with one `skip`.
- **Step 2 — Classify**: still walk the kind priority chain for each citation-eligible snippet; the reconciliation table above governs which `op` to emit for snippets that map to an existing Section.
- **Step 5 — Self-verify**: every `update` / `supersede` / `deprecate` targets a known `section-N` from `existing.sections[]`. If not, return here.
