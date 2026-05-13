---
name: context-align-workflow
description: "Internal procedure for /context-align. Read align workflow schemas, operate candidate ledger payloads, and produce an align-structure-decision for CLI finalize."
---

# Align Workflow Procedure

## TL;DR

Run the align workflow through the CLI-owned beta.8 payload chain: scan segments, prepare neutral candidate operations, finalize an `align-structure-decision`, and let the CLI write finalized ownership.

<reference>

## Canonical Data

- Schema names are exposed by `context schema <name>`.
- Candidate ledger and aggregate payloads are mechanical inputs only.
- Finalized structure is represented by `align-structure-decision`.
- Retired payloads include candidate tables, decision patches, and full-tree finalize documents.
- Existing knowledge is the lookup registry. Use `context mdrive glossary match <name>` / `context mdrive node list --format json` for term/entity reuse; do not read `knowledge/**` and do not create a separate registry file.
- Keep cache-friendly prompt order: fixed protocol and schemas first, existing knowledge lookup second, source-shared payload views third, current candidate batch last. Preserve CLI JSON order and do not add timestamps, random ids, scratch paths, or host paths to generated payloads.
- `align-segments.generation_policy` is the workspace language contract for generated Node titles, summaries, rationale prose, and planned Section wording. Preserve product names, code identifiers, slugs, flags, `block_id` handles, and `source_ref` tokens exactly when needed.
- Gate rules for `domain` and `action` proposals are in `references/gates.md`.
- Coarse-read density and neutral signal rules are in `references/density-profile.md`.
- Candidate anomaly handling, `label_hint`, and `llm_slug_hint` reference rules are in `references/candidate-resolution.md`.

</reference>

<procedures>

Use this only inside `/context-align`.

1. Start from `align-segments`.
2. Inspect it through compact CLI views, not shell parsing: `context workflow show --payload align-segments --view segment --unwrap --format json`, `--view blocks`, and `--view windows`. Read and obey `generation_policy` before authoring any title, summary, rationale, or planned Section wording. The default `blocks` view is a structure summary; drill into content with `--window <window-id>`, `--heading <prefix>`, `--range <start:end>`, or `--token-budget <n>`. `--unwrap` only removes the workflow metadata envelope; it does not change summary/detail behavior.
3. Query existing knowledge for reusable names before proposing new term/service/system/action Nodes. `context mdrive glossary match <name>` returns deterministic `match.kind`, `match.matched`, and `match.rank`; exact title/slug/alias hits should usually become references to the existing Node, not duplicate candidates.
4. Produce coarse-read anchors and neutral content signals as JSON. Pick `density_profile` using `references/density-profile.md`; content signals describe text shape only, not final Node type. Submit the artifact through stdin with `context align --coarse-read - --format json`. The latest `align-coarse-read` payload is only the most recent checkpoint; durable multi-source reading notes live in `align-candidate-ledger.source_readings`. For multiple sources, submit one envelope with `coarse_reads[]`; single-source payloads remain valid.
5. Produce candidate ops batches as JSON. Before each batch, refresh the Term Entity Boundary in `references/gates.md`; its TTL is one batch or about ten candidates, whichever comes first. Use `local:<name>` only inside the current batch; submit each batch through stdin with `context align --ops - --format json`. `--ledger-digest <digest>` is optional; usually omit it and pass it only when you intentionally want stale-batch rejection for a high-assurance retry. The CLI reducer assigns durable candidate ids. For `merge_into`, `supersede`, and `reject`, include the required `*_label_hint` fields from the visible candidate labels.
6. Read the CLI-written candidate ledger and aggregate with `context workflow show --payload align-candidate-ledger --view ledger --unwrap --format json` and `context workflow show --payload align-candidate-aggregate --view aggregate --unwrap --format json`. To revisit one source's coarse-read notes, add `--source <source-id>` to the ledger view; candidates do not carry source ids, so add `--status` or `--candidate-id` only when you also need candidate rows. Treat aggregate fields as mechanical statistics and warnings, not semantic recommendations. Review `anomaly_signals[]`; address clear mistakes with another ops batch, otherwise continue. These signals are warnings and do not by themselves block finalizing.
7. If the CLI returns `agent_hints[]`, follow them before retrying. Legacy-protocol hints mean the submitted payload/schema is retired; switch to the beta.8 schema named in the hint instead of reshaping old fields.
8. Before producing `align-structure-decision`, refresh and apply `references/gates.md`: re-run the Term Entity Boundary decision tree, every `action` needs the five action probes plus structured `inference_sources`, and every `domain` needs `scope_blocks`, resolvable `child_refs`, and `grouping_reason`.
9. Produce `align-structure-decision` as JSON with finalized nodes, `contains_parent`, `depends_on`, and one `block_ownership[]` entry per coverable block. Node titles and summaries must follow the latest `generation_policy` language; do not default to English scaffolding such as "How-To", "Strategy", or "Architecture" when the workspace language is not English. Submit it through stdin with `context align --finalize - --digest <segments-digest>`. Prefer stable `llm_slug_hint` values for `contains_parent_ref`, `from_ref`, `to_ref`, owners, and section owners while the final slug is still being normalized.

   If `align-segments.incremental.mode` is `incremental`, finalize is a delta merge. Submit only the Nodes and ownership supported by the current scanned sources; reference previous finalized Nodes when they are parents, dependencies, domain children, owners, or visibility targets. Absence of an old Node or edge is not a delete signal. Do not redeclare an old parent/domain just to attach a new child. `sections[].owner` must be a Node declared in the current payload; previous finalized Nodes can be referenced structurally but do not receive new section plans from this incremental payload. Existing or previously removed Node slugs cannot change `node_type`; `context align --scan --full` does not bypass that guard. Use a new slug for a different type, or retire the old slug through `context drop` or explicit structure correction before re-aligning.

   For large finalize decisions, use `block_ownership_defaults[]` instead of enumerating every block. Each default names a `source_id` plus the same ownership fields as a block-level entry except `block_id`; the CLI expands it across that source's coverable blocks. Put only exceptions in `block_ownership[]`, which override defaults for their `block_id`. Keep the payload on stdin; do not generate temp JSON files just to list hundreds of ownership rows.

   If a finalized Node is intentionally navigation-only or placeholder-only, set `planned_sections: []` and keep its relation/placeholder blocks as `context_only` or `ignored`; do not assign `owned` evidence or plan a description solely to keep the Node alive. Compile close will create an empty placeholder Node with no active Sections.

   Each `block_ownership[]` entry sets `ownership_role` to one of five values, and the **shape of the rest of the entry depends on the role**. Set `ownership_role` first and only include the fields that role requires; surplus fields trigger schema errors. The CLI returns `agent_hints[].correct_shape` with the canonical JSON skeleton on any role/field mismatch — reshape that entry to match it instead of guessing.

   - `owned`: exactly one slug in `owners[]`, plus `visible_to[]` and `reason`. Do not include `primary_owner`, `context_prefix`, or `question_id`.
   - `shared`: at least two slugs in `owners[]`, `primary_owner` chosen from those owners (the Node that authors cited Sections from this block; secondaries receive compact context and must request full text or raise an ownership challenge before citing it), `visible_to[]`, `reason`. Do not include `context_prefix` or `question_id`.
   - `context_only`: **omit `owners` and `primary_owner` entirely.** Required: `context_prefix` (short summary travelling with citing Sections), `visible_to[]`, `reason`. Do not include `question_id`.
   - `ignored`: **omit `owners`, `primary_owner`, `context_prefix`, and `visible_to`.** Required: `reason`. Use for outdated markers, navigation/external-link blocks, and placeholders without independent knowledge. Do not include `question_id`.
   - `unresolved`: **omit `owners`, `primary_owner`, and `context_prefix`.** Required: `question_id` (matching a top-level `unresolved[].question_id`) and `reason`. Use when classification is blocked by missing evidence.

   After finalize, a second `context align --finalize` is rejected with `workflow-finalize-locked`; follow the returned `remediation_options[]` instead of resubmitting into the finalized workflow. Use `context workflow list --format json` when you need to audit finalize history.

   If finalize returns an `align-finalize-draft` payload, patch the saved draft instead of rewriting the whole finalize document. Use JSON Pointer paths from the returned issues and submit only the corrections:

   ```json
   {
     "schema_version": "align.finalize-patch.v1",
     "operations": [
       { "op": "replace", "path": "/block_ownership/3/primary_owner", "value": "rspack" }
     ]
   }
   ```

   Submit it with `context align --finalize-patch - --payload-digest <draft-digest> --format json`. If issues remain, patch the remaining issue paths; if validation passes, the CLI commits the finalized workflow artifacts.

Never write raw, cache, knowledge, `/tmp`, or workspace scratch files. Never pipe `context ... --format json` through `jq`, `head`, `tail`, `sed`, `cat`, `2>&1`, Python, Node.js, or shell scripts. Never read host persisted output files such as Claude `tool-results/**`; rerun a narrower `context workflow show` command instead. Never submit old candidate-table, decision-patch, or full-tree payloads.

</procedures>
