---
name: skill-align-workflow
description: "Internal procedure for /context:align. Reads CLI-guided align evidence, applies semantic Node classification gates, and emits align structure-intent payloads for CLI validation/finalize."
---

# Align Workflow Procedure

## TL;DR

Run `context align scan --format json`, follow the top-level `next_action.command` to read the CLI-selected evidence path, produce semantic structure payloads, and continue following top-level `next_action`. The CLI owns route, validation, repair commands, and stage guards; this skill owns only semantic classification and source-bound structure judgment.

<reference>

## Canonical Data

- `workflow.next-action-envelope.v2` is authoritative. Branch on `next_action.kind`, execute `next_action.command`, and treat `views[].command` as detail reads rather than a checklist.
- `allowed_actions[]` may permit extra read-only work before the next write; it is not a menu of alternate write paths.
- `agent_hints[]`, when still present, is a short-term cutover mirror or diagnostic. Do not prefer it over top-level `next_action`.
- Schema names and enum values come from `context schema <name>`; use `--view minimal` for protocol discovery before full schema reads.
- Existing knowledge is the lookup registry. Use `context mdrive glossary match <name>` and `context mdrive node list --format json`; do not read `knowledge/**` or create a separate registry file.
- Code projection Nodes are reusable knowledge handles. When document evidence belongs on a code symbol, reuse the code slug instead of creating a parallel document Node.
- `diagnostics.automatic_ownership_adjustments[]` and validation diagnostics are the mechanical external-reference ownership source of truth. Independent reference definitions, pure URLs, relation kind blocks, and multiline reference-only lists default to context_only; submit an explicit `block_ownership[]` owned/shared entry only when such a reference block is primary citation evidence.
- When `pending-relation-refs` is present, inspect it before finalizing graph structure. Use existing/current matches for `contains_parent_ref` or `domain_gate.child_refs`; keep unresolved target slug hints deferred and do not write dangling parent, child, or edge refs. For navigation-only / placeholder-only sources whose child refs are all deferred, the default is no Node, not an empty Domain with `child_refs: []`; only use `entity[term]` when the source title is an atomic term.
- `views[]` and diagnostics distinguish citable evidence from supporting context. Do not promote supporting/context-only material into cited Sections unless a later ownership correction makes it citation-eligible.
- Keep cache-friendly prompt order: fixed protocol/schema first, existing knowledge lookup second, source evidence views third, current semantic payload last. Preserve CLI JSON order and do not add timestamps, random ids, scratch paths, or host paths to generated payloads.
- Node type, tag, fake-Entity, `domain`, and `action` gates are in `references/gates.md`.
- Coarse reading density and neutral signal rules are in `references/density-profile.md`.
- Candidate anomaly handling, `label_hint`, and `llm_slug_hint` reference rules are in `references/candidate-resolution.md`.

</reference>

<procedures>

Use this only inside `/context:align`.

### Step 1 — Start From The Envelope

Run `context align scan --format json`. Confirm `schema_version: "workflow.next-action-envelope.v2"`, then identify `next_action`, `views`, `workflow`, `route`, and `diagnostics`.

If no envelope is present, stop and surface the CLI output; do not reconstruct an align route from old prompt memory.

### Step 2 — Follow The Evidence Read Path

Run the returned `next_action.command`. For structural align work this is normally `read-plan`; after that, follow the `read-plan` / `source-bundle` response's `next_action.command`.

`read-plan` is the navigation surface. It chooses whether the next evidence read is a whole-batch `source-bundle`, a scoped source/window bundle, or an existing coarse-read route. `source-bundle` is annotated source text; read it and then author the requested align JSON yourself, normally `align-structure-intent`. Never pipe bundle text into `context align validate`.

If `source-bundle` omits text for budget, run its `next_action.command`.

Read evidence through semantic CLI views, not shell parsing. Follow `page.next_command` for pagination. If the command contains `--read-cursor`, treat it as opaque continuation state and run it exactly; do not replace it with hand-written `--source`, `--heading`, `--window`, or `--range` selectors. Use `--source`, `--heading`, `--window`, `--range`, and `--token-budget` as view filters only. `--unwrap` removes workflow metadata; it does not expand a compact view into full detail.

If a blocks view returns `align-blocks-read-incomplete`, `page.has_more`, or `truncated: true`, treat that response as a partial read. Do not finalize source-wide ownership or dense planned Sections from source-mapping/headings alone; continue the current detail view only when `page.next_command` is explicitly needed, otherwise return to the read-plan/source-bundle continuation.

### Step 3 — Reuse Existing Knowledge

Query existing knowledge for reusable names before proposing new term/service/system/action Nodes. Exact title/slug/alias hits should usually become references to the existing Node, not duplicate candidates.

When a code projection Node already represents the object, reuse its slug for prose evidence and plan only prose-owned Sections for the current source evidence.

### Step 4 — Classify Semantic Structure

Apply `references/gates.md` before authoring Nodes: classify Node type in order (`action` scale + process evidence, then concrete/term `entity`, then child-bearing `domain`), reject fake Entities only when at least two suspicious signals match, keep `term` separate from concrete tags, and provide required gate evidence.

Source titles and headings are ordinary evidence, not structural authority. Choose titles and summaries that fit the final Node type and the CLI-provided generation policy.

For large or batched payloads, use `references/density-profile.md` and `references/candidate-resolution.md` only when the CLI `next_action` asks for coarse-read or candidate-op payloads. Do not choose those stages yourself.

### Step 5 — Build The Payload Requested By `next_action`

Use `next_action.input_schema` or the matching `context schema <name> --view minimal --format json` output to shape the payload.

For the default `align-structure-intent` path, produce one intent document with semantic Nodes, `section_groups[]`, `ownership_groups[]`, optional explicit `block_ownership[]` patches, and edges. Let CLI generate `section_id` values and expand ownership groups into canonical defaults/exceptions. For long sources, do not hand-enumerate the largest ownership range; use one `{ source_id }` ownership group for the majority owner, then use `{ block_ids }` groups or explicit patches only for exceptions.

Use only `block_ids[]` in `section_groups[]`. Do not invent heading/range/window selectors inside the intent. Treat source heading changes as section-planning signals: sibling sub-headings under a shared parent may stay in one Section when they form one coherent semantic topic; headings with no shared parent should usually split unless you intentionally want one Section to span them. The CLI reports cross-heading groups but does not rewrite your semantic grouping. If one semantic section spans non-contiguous citation-eligible blocks, align may accept the grouping, but finalized ownership will split it into compile draft-ready contiguous runs; compile source-refs templates should stay separate by default. Every block you leave as `owned` or `shared` citation evidence must appear in some section group; otherwise reclassify it as `context_only` or `ignored`. If a no-write/navigation-only/placeholder-only Node is intentionally kept, set `planned_sections: []` explicitly so the CLI knows this was intentional. Do not keep such a Node by default when all children are unresolved relation clues; skip it until a child or content source resolves. Do not express deferred children as `domain_gate.child_refs: []`, and do not turn a container placeholder into `entity[term]` unless the title itself is a useful atomic term.

Emit `depends_on` edges only when cited source blocks explicitly say one Node consumes, requires, calls, is configured by, or is downstream of another Node as a prerequisite, capability provider, upstream input, runtime dependency, or data-flow source. Direction is consumer/downstream -> provider/upstream. Do not create `depends_on` for parent/child containment, `Related`/`See also` lists, sibling co-occurrence, shared table membership, name similarity, or a plain mention without a dependency predicate. `edges[].evidence_blocks[]` must include the block that states the dependency; if the relationship matters but evidence is missing, leave the edge out or add an unresolved question instead of guessing.

Prefer the strongest source-backed `section_kind` that fits the current schema priority chain; avoid planning an entire dense source as `description` when the evidence clearly contains examples, comparison tables, Q&A, decisions, specs, warnings, or principles. Treat kind precision as a drafting quality preference, not a reason to block an otherwise source-backed write. Keep only source-supported semantic decisions in the payload; leave mechanical repair and patch routing to CLI diagnostics.

Canonical `align-structure-decision` is not a parallel authoring path. Use it only when `next_action.input_schema` explicitly asks for it or when auditing/repairing canonical output returned by the CLI.

For coarse-read, candidate-op, patch, ownership, or rescan actions, follow the command and schema in the returned `next_action`. Do not carry old candidate-table, decision-patch, or full-tree payload shapes forward.

### Step 6 — Validate And Submit

Before finalizing, run `context align validate --input - --format json` with the payload matching `next_action.input_schema`. If validate returns blocking diagnostics, repair the exact paths it reports and rerun validate. If validate returns a finalize `next_action`, submit the same validated payload to that command; do not copy compiled canonical JSON from validation output unless the CLI explicitly asks for canonical input.

After finalize succeeds, do not rerun the finalize submit command to confirm success. Use returned `payloads.*.show_command` values, or `context workflow show --payload finalized-ownership --unwrap --format json`, for read-only confirmation; then continue with the returned `next_action.command`, normally `context compile scan --format json`.

If finalize reports node reclassification hints, the submitted Node was changed by a semantic gate. Treat finalized ownership as the source of truth; status counts finalized Nodes, not submitted proposals.

If any write is rejected, follow the returned `next_action` and `reason_code`. Do not retry by guessing direct/batched stages, forcing route bypasses, or editing workflow files.

### Step 7 — Self-verify

- [ ] All writes followed top-level `next_action.command`. If not, return to **Step 1**.
- [ ] Evidence was read through returned `next_action.command`, `how_to_explore[]`, or CLI schema/protocol commands only. If not, return to **Step 2**.
- [ ] Node classification used the semantic gates in `references/gates.md`. If not, return to **Step 4**.
- [ ] URL/reference ownership followed CLI diagnostics, not static prompt rules. If not, return to **Step 5**.
- [ ] The requested align payload passed `context align validate --input - --format json` before finalize. If not, return to **Step 6**.
- [ ] No raw, cache, knowledge, `/tmp`, host tool-results, or workflow scratch files were read or written with generic tools. If violated, restart from **Step 1**.

</procedures>
