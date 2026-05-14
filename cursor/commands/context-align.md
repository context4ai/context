---
description: "Align raw material into a finalized Node structure and block ownership."
argument-hint: ""
allowed-tools: Bash(context:*)
---

Review raw material and confirm the Node tree before compiling knowledge.

---

## Your Task

Run the beta.8 align workflow. `/context-align` is the user entrypoint; internal stages are workflow payloads, not public slash commands.

Keep the prompt shape stable: read fixed schema/protocol first, then existing knowledge lookup, then the current source-specific payload. Do not reorder CLI JSON, add timestamps, or invent scratch paths.

1. Run `context align --scan --format json`. Use the returned workflow payload name, scope id, digest, and `next_command` / `show_command` fields as the continuation handles.
   - If the align-segments payload includes `generation_policy`, use it as the language contract for generated Node titles, summaries, rationale prose, and planned Section wording. Source-bound Section wording should stay close to the cited source language when it differs from the workspace language. Preserve product names, code identifiers, slugs, flags, `block_id` handles, and citation tokens exactly when needed.
2. Read schema and payloads through CLI only:
   - `context schema align-segments`
   - `context schema align-coarse-read`
   - `context schema align-candidate-ops`
   - `context schema align-candidate-ledger`
   - `context schema align-candidate-aggregate`
   - `context schema align-structure-decision`
   - `context workflow show --payload align-segments --view segment --unwrap --format json`
   - `context workflow show --payload align-segments --view blocks --unwrap --format json` (summary only)
   - `context workflow show --payload align-segments --view windows --unwrap --format json`
   - Drill into content only with focused filters such as `--window <window-id|src-N:M>`, `--heading <prefix>`, `--range <start:end>`, or `--token-budget <n>`. `src-N:M` means the M-th window under the `source_alias` shown by `--view windows`.
   - `--unwrap` only removes the workflow metadata envelope. It does not turn a summary view into detail output.
3. Reuse existing knowledge before inventing candidates. For named terms or entities, prefer `context mdrive glossary match <name>` and `context mdrive node list --format json` over direct file reads. Treat `match.kind`, `match.matched`, and `match.rank` as stable lookup hints: exact title/slug/alias hits should usually reuse the existing Node instead of creating another one.
   - Apply packaged `../skills/skill-align-workflow/SKILL.md` Node classification gates before candidate ops and again before finalize: Action requires scale plus process evidence; Entity requires a concrete A/B tag or pure `term`; Domain requires child Nodes; fake Entities need at least two suspicious signals before downgrade.
4. Submit generated workflow payloads directly through stdin, preferably as JSON. Use YAML schemas only for reading examples when helpful; generated artifacts should avoid YAML quoting/indentation failure loops. Do not create `/tmp` or workspace scratch files for align payloads. The CLI owns ids, reducer validation, workflow payload storage, and mechanical aggregate. You own semantic discovery, Node type/tag decisions, structure decisions, and user-facing questions.
   - Save coarse-read with `context align --coarse-read - --format json`.
     The latest `align-coarse-read` payload is only the most recent checkpoint; durable multi-source reading notes are stored under `align-candidate-ledger.source_readings`.
     For multiple sources, submit one envelope with `coarse_reads[]`; single-source payloads remain valid.
   - Submit each candidate batch with `context align --ops - --format json`.
   - `--ledger-digest <digest>` is optional. Usually omit it and let the CLI merge against the current ledger; pass it only when you intentionally want stale-batch rejection for a high-assurance retry.
   - Read the resulting payloads with `context workflow show --payload align-candidate-ledger --view ledger --unwrap --format json` and `context workflow show --payload align-candidate-aggregate --view aggregate --unwrap --format json`. To revisit one source's coarse-read notes, add `--source <source-id>` to the ledger view; candidates do not carry source ids, so add `--status` or `--candidate-id` only when you also need candidate rows.
   - Review `anomaly_signals[]` as warnings: fix clear mistakes with another ops batch, otherwise continue to finalize and carry the warning rationale in your final decision/report.
5. If any CLI command returns `agent_hints[]`, follow those hints before retrying. Legacy-protocol hints mean the submitted payload or schema name is retired; switch to the beta.8 schema named in the hint instead of adapting old fields.
6. Finalize only with `align-structure-decision`:

```bash
context align --finalize -
```

If finalize returns an `align-finalize-draft` payload, patch that saved draft with JSON Pointer paths from the returned issues instead of resubmitting the full document:

```json
{
  "schema_version": "align.finalize-patch.v1",
  "operations": [
    { "op": "replace", "path": "/block_ownership/3/primary_owner", "value": "rspack" }
  ]
}
```

Submit the patch with `context align --finalize-patch - --format json`. Add `--payload-digest` only when you intentionally want an explicit stale guard.

After a successful finalize, use a targeted ownership patch for small role corrections only; do not resubmit the whole structure just to move a few blocks between `context_only`, `ignored`, `owned`, or `shared`:

```json
{
  "schema_version": "align.ownership-patch.v1",
  "base_digest": "sha256:<finalized-ownership-digest>",
  "block_ownership": [
    {
      "block_id": "<block-id>",
      "ownership_role": "owned",
      "owners": ["<node-slug>"],
      "visible_to": ["<node-slug>"],
      "reason": "Why this block is citation evidence for the node."
    }
  ]
}
```

Submit it with `context align --ownership-patch - --format json`. Keep `base_digest` in the patch body when you want stale ownership rejection. Use `context schema align-ownership-patch` for the exact shape.

If `align-segments.incremental.mode` is `incremental`, the finalize step is a delta merge: submit only the Nodes and block ownership supported by the current scanned sources, and reference previous finalized Nodes when they are parents, dependencies, domain children, owners, or visibility targets. Absence of an old Node or edge is not a delete signal. Do not redeclare an old parent/domain just to attach a new child. `sections[].owner` must be a Node declared in the current payload; previous finalized Nodes can be referenced structurally but do not receive new section plans from this incremental payload. Existing or previously removed Node slugs cannot change `node_type`; `context align --scan --full` does not bypass that guard. Use a new slug for a different type, or retire the old slug through `context drop` or explicit structure correction before re-aligning.

`nodes[].planned_sections` is the distinct set of Section kinds planned for that Node. List each kind at most once; do not copy `sections[].section_kind` one-for-one when a Node has multiple Sections of the same kind.

For large finalize decisions, use `block_ownership_defaults[]` instead of enumerating every block. Each default names a `source_id` plus the same ownership fields as a block-level entry except `block_id`; the CLI expands it across that source's coverable blocks. Put only exceptions in `block_ownership[]`, which override defaults for their `block_id`. Keep the payload on stdin; do not generate temp JSON files just to list hundreds of ownership rows.

If a source is only navigation or placeholder context, keep the Node only when the graph/slug is still useful: set `planned_sections: []`, mark the navigation evidence `context_only` or `ignored` as appropriate, and do not promote relation lines to `owned` just to satisfy citations. Compile close will materialize an empty placeholder Node with no active Sections.

Do not submit legacy candidate tables, old patch payloads, or full-tree proposal files. Do not write `knowledge/`; align finalize writes finalized workflow artifacts and source ownership only.

## Constraints

- Node types are `domain`, `entity`, and `action`.
- Entity tag `term` is mutually exclusive with concrete A/B tags. If both identities matter, create one concrete Entity and one separate term Entity, then connect them later with Section-local `refers_to_nodes[]`.
- Document structure uses `nodes[].contains_parent` and `edges[].edge_type = "depends_on"` only.
- Section-local references stay in `refers_to_nodes[]`; do not project them into Node edges.
- Semantic boundary failures should become downgrade warnings or unresolved items. Do not retry the same semantic judgment in a loop.
- Hard reference failures must be repaired at the exact op/path with a valid id/ref from the current payload. Use CLI `agent_hints[]` as the repair contract when present.
- Do not read or modify source snapshots, caches, or rendered workflow artifacts with generic tools. Use `context workflow show`, schema commands, payload name, scope id, digest, and candidate ids as the workflow contract.
- Do not pipe `context ... --format json` through `jq`, `head`, `tail`, `sed`, `cat`, `2>&1`, Python, Node.js, or shell scripts. Do not read host persisted output files such as Claude `tool-results/**`. Consume complete CLI stdout directly. Use compact views plus `--window` / `--heading` / `--range` / `--token-budget` when the full payload is too large.

## Final Report

Report in the user's language. Include final Node counts by type, unresolved ownership count, workflow payload identifiers, and the next step (`/context-compile` or another `/context-align` pass for unresolved structure).
