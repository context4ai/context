---
name: skill-align-workflow
description: "Internal procedure for /context:align. Reads CLI-guided align evidence, applies semantic Node classification gates, and emits align structure-decision payloads for CLI validation/finalize."
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
- When `pending-relation-refs` is present, inspect it before finalizing graph structure. Use existing matches for `contains_parent_ref` or `domain_gate.child_refs`; keep unresolved target slug hints deferred and do not write dangling parent or edge refs.
- `views[]` and diagnostics distinguish citable evidence from supporting context. Do not promote supporting/context-only material into cited Sections unless a later ownership correction makes it citation-eligible.
- Keep cache-friendly prompt order: fixed protocol/schema first, existing knowledge lookup second, source evidence views third, current semantic payload last. Preserve CLI JSON order and do not add timestamps, random ids, scratch paths, or host paths to generated payloads.
- Node type, tag, fake-Entity, `domain`, and `action` gates are in `skill-align-workflow/references/gates.md`.
- Coarse reading density and neutral signal rules are in `skill-align-workflow/references/density-profile.md`.
- Candidate anomaly handling, `label_hint`, and `llm_slug_hint` reference rules are in `skill-align-workflow/references/candidate-resolution.md`.

</reference>

<procedures>

Use this only inside `/context:align`.

### Step 1 — Start From The Envelope

Run `context align scan --format json`. Confirm `schema_version: "workflow.next-action-envelope.v2"`, then identify `next_action`, `views`, `workflow`, `route`, and `diagnostics`.

If no envelope is present, stop and surface the CLI output; do not reconstruct an align route from old prompt memory.

### Step 2 — Follow The Evidence Read Path

Run the returned `next_action.command`. For structural align work this is normally `read-plan`; after that, follow the `read-plan` / `source-bundle` response's `next_action.command`.

`read-plan` is the navigation surface. It chooses whether the next evidence read is a whole-batch `source-bundle`, a scoped source/window bundle, or an existing coarse-read route. `source-bundle` is annotated source text; read it and then author the requested align JSON yourself. Never pipe bundle text into `context align validate`.

Read evidence through semantic CLI views, not shell parsing. Follow `page.next_command` for pagination. Use `--source`, `--heading`, `--window`, and `--token-budget` as view filters only. `--unwrap` removes workflow metadata; it does not expand a compact view into full detail.

If a blocks view returns `align-blocks-read-incomplete`, `page.has_more`, or `truncated: true`, treat that response as a partial read. Do not finalize source-wide ownership or dense planned Sections from source-mapping/headings alone; continue the current detail view only when `page.next_command` is explicitly needed, otherwise return to the read-plan/source-bundle continuation.

### Step 3 — Reuse Existing Knowledge

Query existing knowledge for reusable names before proposing new term/service/system/action Nodes. Exact title/slug/alias hits should usually become references to the existing Node, not duplicate candidates.

When a code projection Node already represents the object, reuse its slug for prose evidence and plan only prose-owned Sections for the current source evidence.

### Step 4 — Classify Semantic Structure

Apply `skill-align-workflow/references/gates.md` before authoring Nodes: classify Node type in order (`action` scale + process evidence, then concrete/term `entity`, then child-bearing `domain`), reject fake Entities only when at least two suspicious signals match, keep `term` separate from concrete tags, and provide required gate evidence.

Source titles and headings are ordinary evidence, not structural authority. Choose titles and summaries that fit the final Node type and the CLI-provided generation policy.

For large or batched payloads, use `skill-align-workflow/references/density-profile.md` and `skill-align-workflow/references/candidate-resolution.md` only when the CLI `next_action` asks for coarse-read or candidate-op payloads. Do not choose those stages yourself.

### Step 5 — Build The Payload Requested By `next_action`

Use `next_action.input_schema` or the matching `context schema <name> --view minimal --format json` output to shape the payload.

For `submit_structure_decision`, produce one structure-decision document with finalized Nodes, document edges, planned Sections, and ownership. Prefer the strongest source-backed `section_kind` that fits the current schema priority chain; avoid planning an entire dense source as `description` when the evidence clearly contains examples, comparison tables, Q&A, decisions, specs, warnings, or principles. Treat kind precision as a drafting quality preference, not a reason to block an otherwise source-backed write. Keep only source-supported semantic decisions in the payload; leave mechanical repair and patch routing to CLI diagnostics.

For coarse-read, candidate-op, patch, ownership, or rescan actions, follow the command and schema in the returned `next_action`. Do not carry old candidate-table, decision-patch, or full-tree payload shapes forward.

### Step 6 — Validate And Submit

Before finalizing a structure decision, run `context align validate --input - --format json`. If validate returns blocking diagnostics, repair the exact paths it reports and rerun validate. If validate returns a finalize `next_action`, submit the same validated payload to that command.

If any write is rejected, follow the returned `next_action` and `reason_code`. Do not retry by guessing direct/batched stages, forcing route bypasses, or editing workflow files.

### Step 7 — Self-verify

- [ ] All writes followed top-level `next_action.command`. If not, return to **Step 1**.
- [ ] Evidence was read through returned `next_action.command`, `how_to_explore[]`, or CLI schema/protocol commands only. If not, return to **Step 2**.
- [ ] Node classification used the semantic gates in `skill-align-workflow/references/gates.md`. If not, return to **Step 4**.
- [ ] URL/reference ownership followed CLI diagnostics, not static prompt rules. If not, return to **Step 5**.
- [ ] Structure decisions passed `context align validate --input - --format json` before finalize. If not, return to **Step 6**.
- [ ] No raw, cache, knowledge, `/tmp`, host tool-results, or workflow scratch files were read or written with generic tools. If violated, restart from **Step 1**.

</procedures>
