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
   - If the align-segments payload includes `generation_policy`, use it as the language contract for generated Node titles, summaries, rationale prose, and planned Section wording. Preserve product names, code identifiers, slugs, flags, and citation tokens exactly when needed.
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
   - Drill into content only with semantic filters such as `--window <window-id>`, `--heading <prefix>`, `--range <start:end>`, or `--token-budget <n>`.
   - `--unwrap` only removes the workflow metadata envelope. It does not turn a summary view into detail output.
3. Reuse existing knowledge before inventing candidates. For named terms or entities, prefer `context mdrive glossary match <name>` and `context mdrive node list --format json` over direct file reads. Treat `match.kind`, `match.matched`, and `match.rank` as stable lookup hints: exact title/slug/alias hits should usually reuse the existing Node instead of creating another one.
4. Submit generated workflow payloads directly through stdin, preferably as JSON. Use YAML schemas only for reading examples when helpful; generated artifacts should avoid YAML quoting/indentation failure loops. Do not create `/tmp` or workspace scratch files for align payloads. The CLI owns ids, reducer validation, workflow payload storage, and mechanical aggregate. You own semantic discovery, Node type/tag decisions, structure decisions, and user-facing questions.
   - Save coarse-read with `context align --coarse-read - --format json`.
   - Submit each candidate batch with `context align --ops - --format json`.
   - After the first batch, pass the current ledger digest as `--ledger-digest <digest>` so stale batches are rejected.
   - Read the resulting payloads with `context workflow show --payload align-candidate-ledger --view ledger --unwrap --format json` and `context workflow show --payload align-candidate-aggregate --view aggregate --unwrap --format json`.
5. If any CLI command returns `agent_hints[]`, follow those hints before retrying. Legacy-protocol hints mean the submitted payload or schema name is retired; switch to the beta.8 schema named in the hint instead of adapting old fields.
6. Finalize only with `align-structure-decision`:

```bash
context align --finalize - --digest <segments-digest>
```

Do not submit legacy candidate tables, old patch payloads, or full-tree proposal files. Do not write `knowledge/`; align finalize writes finalized workflow artifacts and source ownership only.

## Constraints

- Node types are `domain`, `entity`, and `action`.
- Document structure uses `nodes[].contains_parent` and `edges[].edge_type = "depends_on"` only.
- Section-local references stay in `refers_to_nodes[]`; do not project them into Node edges.
- Semantic boundary failures should become downgrade warnings or unresolved items. Do not retry the same semantic judgment in a loop.
- Hard reference failures must be repaired at the exact op/path with a valid id/ref from the current payload. Use CLI `agent_hints[]` as the repair contract when present.
- Do not read or modify source snapshots, caches, or rendered workflow artifacts with generic tools. Use `context workflow show`, schema commands, payload name, scope id, digest, and candidate ids as the workflow contract.
- Do not pipe `context ... --format json` through `jq`, `head`, `tail`, `sed`, `cat`, `2>&1`, Python, Node.js, or shell scripts. Do not read host persisted output files such as Claude `tool-results/**`. Consume complete CLI stdout directly. Use compact views plus `--window` / `--heading` / `--range` / `--token-budget` when the full payload is too large.

## Final Report

Report in the user's language. Include final Node counts by type, unresolved ownership count, workflow payload identifiers, and the next step (`/context-compile` or another `/context-align` pass for unresolved structure).
