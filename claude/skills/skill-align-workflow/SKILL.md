---
name: context-align-workflow
description: "Internal procedure for /context:align. Read align workflow schemas, operate candidate ledger payloads, and produce an align-structure-decision for CLI finalize."
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
- `align-segments.generation_policy` is the workspace language contract for generated Node titles, summaries, rationale prose, and planned Section wording. Source-bound Section wording should stay close to the cited source language when it differs from the workspace language. Preserve product names, code identifiers, slugs, flags, `block_id` handles, and `source_ref` tokens exactly when needed.
- Source titles and headings are ordinary evidence, not structural authority. Do not automatically copy them into Node titles or aliases; classify the evidence referent first, then generate a title that fits the final Node type.
- Node type, tag, fake-Entity, `domain`, and `action` gates are in `references/gates.md`.
- Coarse-read density and neutral signal rules are in `references/density-profile.md`.
- Candidate anomaly handling, `label_hint`, and `llm_slug_hint` reference rules are in `references/candidate-resolution.md`.

</reference>

<procedures>

Use this only inside `/context:align`.

1. Start from `align-segments`.
2. Inspect it through semantic CLI views, not shell parsing: `context workflow show --payload align-segments --view segment --unwrap --format json`, `context workflow show --payload align-segments --view source-mapping --unwrap --format json`, `context workflow show --payload align-segments --view blocks --token-budget 2000 --unwrap --format json`, and `context workflow show --payload align-segments --view windows --unwrap --format json`. Read and obey `generation_policy` before authoring any title, summary, rationale, or planned Section wording. Use `source-mapping` for source-to-block id ranges before writing coarse-read `evidence_blocks`; drill into content with `--source <source-id>`, `--heading <prefix>`, `--window <window-id|src-N:M>` (`src-N:M` means the M-th window under `source_alias` src-N from `--view windows`), or a larger `--token-budget <n>`. If a budgeted view returns `truncated: true`, follow `how_to_explore[]` commands before expanding the budget. `--unwrap` only removes the workflow metadata envelope; it does not change the selected view.
3. Query existing knowledge for reusable names before proposing new term/service/system/action Nodes. `context mdrive glossary match <name>` returns deterministic `match.kind`, `match.matched`, and `match.rank`; exact title/slug/alias hits should usually become references to the existing Node, not duplicate candidates.
4. Produce coarse-read anchors and neutral content signals as JSON. Pick `density_profile` using `references/density-profile.md`; content signals describe text shape only, not final Node type. Submit the artifact through stdin with `context align --coarse-read - --format json`. Prefer omitting `schema_version`; the CLI infers single-source vs batch from shape. The latest `align-coarse-read` payload is only the most recent checkpoint; durable multi-source reading notes live in `align-candidate-ledger.source_readings`. For multiple sources, submit one envelope with `coarse_reads[]`; each entry must use the current coarse-read fields (`source_id`, `density_profile`, `reading_anchors`, `section_proposals`), not retired `reading_notes` / `block_readings`.
5. Produce candidate ops batches as JSON. Before each batch, refresh the Node classification gates in `references/gates.md`; their TTL is one batch or about ten candidates, whichever comes first. Candidate slugs/titles are provisional: if a source heading says "方案", "架构", "流程", "策略", "演练", or similar scope/process language, do not preserve that wording unless the final Node type really needs it. Use `local:<name>` only inside the current batch; submit each batch through stdin with `context align --ops - --format json`. Prefer omitting `schema_version`; the CLI normalizes candidate ops to the current schema. `--ledger-digest <digest>` is optional; usually omit it and pass it only when you intentionally want stale-batch rejection for a high-assurance retry. The CLI reducer assigns durable candidate ids. For `merge_into`, `supersede`, and `reject`, include the required `*_label_hint` fields from the visible candidate labels.
6. Read the CLI-written candidate ledger and aggregate with `context workflow show --payload align-candidate-ledger --view ledger --unwrap --format json` and `context workflow show --payload align-candidate-aggregate --view aggregate --unwrap --format json`. To revisit one source's coarse-read notes, add `--source <source-id>` to the ledger view; candidates do not carry source ids, so add `--status` or `--candidate-id` only when you also need candidate rows. Treat aggregate fields as mechanical statistics and warnings, not semantic recommendations. Review `anomaly_signals[]`; address clear mistakes with another ops batch, otherwise continue. These signals are warnings and do not by themselves block finalizing.
7. If the CLI returns `agent_hints[]`, follow them before retrying. Legacy-protocol hints mean the submitted payload/schema is retired; switch to the beta.8 schema named in the hint instead of reshaping old fields.
8. Before producing `align-structure-decision`, refresh and apply `references/gates.md`: classify Node type in order (`action` scale + process evidence, then concrete/term `entity`, then child-bearing `domain`), reject fake Entities only when at least two suspicious signals match, keep `term` separate from concrete A/B tags, and provide required `action_gate` / `domain_gate` fields. Classification is about the content referent, not the source title. After type is chosen, rewrite the Node title to fit that type: Entities name concrete objects or atomic terms, Domains name grouping scopes, and Actions name executable processes.
9. Produce `align-structure-decision` as JSON with finalized nodes, `contains_parent`, `depends_on`, and one `block_ownership[]` entry per coverable block. Node titles and summaries must follow the latest `generation_policy` language; do not default to English scaffolding such as "How-To", "Strategy", or "Architecture" when the workspace language is not English. Do not automatically add the original source title as an alias. Submit it through stdin with `context align --finalize -`; the CLI resolves the current align-segments payload. Prefer stable `llm_slug_hint` values for `contains_parent_ref`, `from_ref`, `to_ref`, owners, and section owners while the final slug is still being normalized.

   If `align-segments.incremental.mode` is `incremental`, finalize is a delta merge. Submit only the Nodes and ownership supported by the current scanned sources; reference previous finalized Nodes when they are parents, dependencies, domain children, owners, or visibility targets. Absence of an old Node or edge is not a delete signal. Do not redeclare an old parent/domain just to attach a new child. `sections[].owner` must be a Node declared in the current payload; previous finalized Nodes can be referenced structurally but do not receive new section plans from this incremental payload. Existing or previously removed Node slugs cannot change `node_type`; `context align --scan --full` does not bypass that guard. Use a new slug for a different type, or retire the old slug through `context drop` or explicit structure correction before re-aligning.

   `nodes[].planned_sections` is the distinct set of Section kinds planned for that Node. List each kind at most once; do not copy `sections[].section_kind` one-for-one when a Node has multiple Sections of the same kind.

   For large finalize decisions, use `block_ownership_defaults[]` instead of enumerating every block. Each default names a `source_id` plus the same ownership fields as a block-level entry except `block_id`; the CLI expands it across that source's coverable blocks. Put only exceptions in `block_ownership[]`, which override defaults for their `block_id`. Keep the payload on stdin; do not generate temp JSON files just to list hundreds of ownership rows.

   If a finalized Node is intentionally navigation-only or placeholder-only, set `planned_sections: []` and keep its relation/placeholder blocks as `context_only` or `ignored`; do not assign `owned` evidence or plan a description solely to keep the Node alive. This is the expected placeholder-domain shape when the graph/slug is useful but the source has no citation-worthy body content. Compile close will create an empty placeholder Node with no active Sections.

   Each `block_ownership[]` entry sets `ownership_role` to one of five values, and the **shape of the rest of the entry depends on the role**. Set `ownership_role` first and only include the fields that role requires; surplus fields trigger schema errors. The CLI returns `agent_hints[].correct_shape` with the canonical JSON skeleton on any role/field mismatch — reshape that entry to match it instead of guessing.

   - `owned`: exactly one slug in `owners[]`, plus `visible_to[]` and `reason`. Do not include `primary_owner` or `question_id`.
   - `shared`: at least two slugs in `owners[]`, `primary_owner` chosen from those owners (the Node that authors cited Sections from this block; secondaries receive compact raw preview and must request full text or raise an ownership challenge before citing it), `visible_to[]`, `reason`. Do not include `question_id`.
   - `context_only`: **omit `owners` and `primary_owner` entirely.** Required: `visible_to[]`, `reason`. Do not include `question_id`. Also use this for **external-URL reference-link blocks** (orphan `[label]: https://...` / `[label]: http://...` definitions, including ByteDance internal hosts and Lark / docs wikis) when no Node in this batch clearly owns the references — the URLs themselves are unique knowledge not duplicated in body prose, so they must stay reachable downstream even if no inline body usage exists. `context_only` keeps those URLs as raw background only; compile must not cite them as active Sections unless a later ownership patch upgrades the block to `owned` / primary `shared`.
   - `ignored`: **omit `owners`, `primary_owner`, and `visible_to`.** Required: `reason`. Use for outdated markers, **intra-workspace navigation lines** (`Parent:` / `Children:` / `Related:` / `Relations:` rows whose targets are other Nodes already represented in the align graph), and placeholders without independent knowledge. **Do not put external-URL reference-link blocks here** — those carry unique URLs that the align graph cannot reconstruct; route them to `context_only` (or `owned` / `shared` if a Node should author a citation-eligible "相关链接" Section). Do not include `question_id`.
   - `unresolved`: **omit `owners` and `primary_owner`.** Required: `question_id` (matching a top-level `unresolved[].question_id`) and `reason`. Use when classification is blocked by missing evidence.

   After finalize, a second `context align --finalize` is rejected with `workflow-finalize-locked`; follow the returned `remediation_options[]` instead of resubmitting into the finalized workflow. Use `context workflow list --format json` when you need to audit finalize history.

   If finalize returns an `align-finalize-draft` payload, patch the saved draft instead of rewriting the whole finalize document. Use JSON Pointer paths from the returned issues and submit only the corrections. Patch paths are relative to `raw_decision`, so use `/nodes/...`, `/sections/...`, or `/block_ownership/...`, not `/raw_decision/...`:

   ```json
   {
     "schema_version": "align.finalize-patch.v1",
     "operations": [
       { "op": "replace", "path": "/block_ownership/3/primary_owner", "value": "rspack" }
     ]
   }
   ```

   Submit it with `context align --finalize-patch - --format json`. Add `--payload-digest` only when you intentionally want an explicit stale guard. If issues remain, patch the remaining issue paths; if validation passes, the CLI commits the finalized workflow artifacts.

   After finalize has succeeded, do not resend the full structure just to correct a few block roles. Submit a narrow ownership patch against the current finalized ownership digest:

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

   Submit it with `context align --ownership-patch - --format json`. Keep `base_digest` in the patch body when you want stale ownership rejection. Use `context schema align-ownership-patch` when uncertain.

Never write raw, cache, knowledge, `/tmp`, or workspace scratch files. Never pipe `context ... --format json` through `jq`, `head`, `tail`, `sed`, `cat`, `2>&1`, Python, Node.js, or shell scripts. Never read host persisted output files such as Claude `tool-results/**`; rerun a narrower `context workflow show` command instead. Never submit old candidate-table, decision-patch, or full-tree payloads.

</procedures>
