---
description: "Align raw material into a finalized Node structure and block ownership."
argument-hint: ""
allowed-tools: Bash(context:*)
---

Review raw material and confirm the Node tree before compiling knowledge.

---

## Workflow

Run the CLI-guided align workflow. `/context-align` is the user entrypoint; the CLI owns route, stage, validation, workflow payload storage, and the canonical next write. The agent owns semantic Node/Section grouping and any user-facing questions.

If `$ARGUMENTS` starts with `code`, run `context align code [slug]`, report the dry-run projection plan, and stop. This route is CLI-owned and does not enter the prose align workflow.

### Step 1 — Scan

Run `context align scan --format json`.

Use the returned `workflow.next-action-envelope.v2` as the source of truth:

- Follow top-level `next_action.kind` and `next_action.command` for every write.
- Use only the returned `next_action.command` for the next required step. When it points at `read-plan`, run that one command first.
- Treat `allowed_actions[]` as permission for read-only insertions such as `show_view`; do not choose a different write path from it.
- Treat `agent_hints[]`, when present, as a temporary mirror or diagnostic only. If it conflicts with `next_action`, follow `next_action`.
- Read workflow payload views only through returned `context workflow show` commands.
- If the host truncates scan stdout but the preview includes top-level `next_action.command`, run that command. If `next_action` is not visible, rerun the scan command; do not recover host tool-result files.

For protocol discovery, prefer narrow commands:

- `context schema workflow.next-action-envelope.v2 --view minimal --format json`
- `context protocol show align-compile --format json`
- `context schema align-structure-intent --view minimal --format json` — includes required fields, enums, mount matrix, and a minimal authoring example; use full schema only for extended notes.

### Step 2 — Read Evidence Through The Single Evidence Path

If scan returns a `read-plan` command, run it and then follow the next command returned by that view. The normal path is:

- `read-plan` summarizes source size, active source set, navigation/placeholder sources, and the next evidence command.
- `source-bundle` returns the selected source text with `@c4a` block annotations. Read it, then write the requested align JSON yourself, normally `align-structure-intent`; do not pipe the bundle text into `context align validate`.
- If `source-bundle` omits text for budget, `read_scope_complete: false`, `page.has_more: true`, or the final `source-bundle:end` annotation is missing, run its `next_action.command` before authoring.
- If the next command contains `--read-cursor`, treat it as opaque continuation state. Do not decode it and do not replace it with hand-written `--source` / `--window` / `--range` / `--heading` selectors.
- `blocks`, `windows`, `block-index`, `source-mapping`, and `pending-relation-refs` are detail views only. Use them when the read-plan/source-bundle next action or `how_to_explore[]` asks for a narrow follow-up.

When a view returns `page.next_command`, follow that command to continue the same semantic view. Use `--source`, `--heading`, `--window`, `--range`, or `--token-budget` only as view filters; do not inspect workflow files, cache files, host tool-results, or stdout fragments with generic tools.

If a detail view returns `align-blocks-read-incomplete`, `page.has_more`, or `truncated: true`, the response is a partial read. Return to the read-plan/source-bundle continuation instead of treating that partial JSON page as the complete source.

### Step 3 — Produce The Semantic Payload

Reuse existing knowledge before inventing new Nodes: use `context mdrive glossary match <name>` and `context mdrive node list --format json` for term/entity reuse.

Apply the procedure in `../skills/skill-align-workflow/SKILL.md` for Node classification gates and align intent procedure. Keep generated payloads on stdin. Prefer heredocs for small payloads; if payload staging is needed for large or parallel writes, use the workspace AGENTS.md scratch path (`.context/.tmp/agent-payloads/<run-id>/...` in embedded workspaces, `.tmp/agent-payloads/<run-id>/...` in root-layout workspaces) and redirect stdin from it. Never reuse fixed `/tmp/c4a-*` names and never place scratch payloads under CLI-managed `.tmp/context-cli/`, `output/`, `archive/`, `knowledge/`, or `raw/` truth directories.

Use CLI diagnostics instead of static prompt rules:

- `diagnostics.automatic_ownership_adjustments[]` explains mechanical structural-block demotions and the explicit ownership override shape.
- `pending-relation-refs` lists explicit Parent/Children/Related markdown links. Reuse existing target Nodes when present; keep unresolved target slug hints deferred instead of writing dangling `contains_parent` / `domain_gate.child_refs`. A relation/placeholder source may still be preserved as a no-write Node with root-level `planned_sections: []`; preserve it before default skip when an explicit retrieval need, graph need, or atomic/concrete title gives the page standalone retrieval value, even if every child ref is unresolved. Never put `planned_sections` inside `domain_gate`. If it is kept without graph support, keep supporting blocks `context_only` with `visible_to`. If you skip the source and emit no Node for it, still cover its coverable blocks with an `ownership_groups[]` rule, usually source-wide `ignored` for pure placeholders. `ignored` disposes unused material and does not support the placeholder by itself. Unresolved children stay pending rather than becoming graph edges.
- Validation diagnostics identify contiguity, citation eligibility, ownership, and mount-matrix problems.
- `views[]` and `diagnostics` distinguish citable evidence from supporting context; do not infer citation eligibility from raw ownership prose.

### Step 4 — Validate And Submit

When the envelope asks for `validate_align_decision`, submit the payload matching `next_action.input_schema`, normally the `align-structure-intent` you authored after reading evidence, to `context align validate --input - --format json` or the exact returned command. If validate returns blocking diagnostics, repair the payload and rerun validate. If validate returns a `submit_structure_decision` next_action, execute that command with the same validated payload.

After a finalize command succeeds, do not submit finalize again to confirm it. Use returned `payloads.*.show_command` values, or `context workflow show --payload finalized-ownership --unwrap --format json`, for read-only confirmation; then follow `next_action.command`, normally `context compile scan --format json`.

If finalize reports node reclassification hints, treat finalized ownership as the source of truth. `context status` reports finalized node types, not the originally submitted proposal.

For any other write kind, execute the top-level `next_action.command` exactly. If the command rejects the payload, follow the returned `next_action` and `reason_code`; do not infer a route fallback from memory.

### Final Report

Report in the user's conversation language. Summarize finalized Node counts and meaningful warnings. Do not surface workflow payload digests, scope ids, block hashes, snapshot digests, or absolute paths.
