---
name: align
description: >
  Align raw material into a finalized Node structure and block ownership. Equivalent to Claude /context:align; use the local `context` CLI for workspace writes.
tools:
  - Bash
---

# Align

Public C4A Context entry for agents that expose skills instead of Claude slash commands.

- Public entry: `align`
- Claude equivalent: `/context:align`
- CLI primitive prefix: `context ...`
- Internal procedures live under `references/internal-procedures/`; read each referenced file in full before following that step.

---

## Workflow

Run the CLI-guided align workflow. `/context:align` is the user entrypoint; the CLI owns route, stage, validation, workflow payload storage, and the canonical next write. The agent owns semantic Node/Section grouping and any user-facing questions.

If `$ARGUMENTS` starts with `code`, run `context align code [slug]`, report the dry-run projection plan, and stop. This route is CLI-owned and does not enter the prose align workflow.

### Step 1 — Scan

Run `context align scan --format json`.

Use the returned `workflow.next-action-envelope.v2` as the source of truth:

- Follow top-level `next_action.kind` and `next_action.command` for every write.
- Use `views[].command` for evidence reads, prioritizing entries with `expected: true`.
- Treat `allowed_actions[]` as permission for read-only insertions such as `show_view`; do not choose a different write path from it.
- Treat `agent_hints[]`, when present, as a temporary mirror or diagnostic only. If it conflicts with `next_action`, follow `next_action`.

For protocol discovery, prefer narrow commands:

- `context schema workflow.next-action-envelope.v2 --view minimal --format json`
- `context protocol show align-compile --format json`
- `context schema align-structure-decision --view minimal --format json`

### Step 2 — Read Evidence Through Views

Run the expected view commands from the envelope. For additional reads, use only budget-safe workflow views such as:

- `context workflow show --payload align-segments --view blocks --page-size 10 --token-budget 8000 --unwrap --format json`
- `context workflow show --payload align-segments --view windows --page-size 10 --compact-hints --unwrap --format json`
- `context workflow show --payload align-segments --view source-mapping --unwrap --format json`

When a view returns `page.next_command`, follow that command to continue the same semantic view. Use `--source`, `--heading`, `--window`, or `--token-budget` only as view filters; do not inspect workflow files, cache files, host tool-results, or stdout fragments with generic tools.

If a blocks view returns `align-blocks-read-incomplete`, `page.has_more`, or `truncated: true`, the response is a partial read. Do not finalize broad ownership or dense planned Sections from source-mapping/headings alone; follow `page.next_command` or the `how_to_explore[]` source full-read / expand-budget command first, then decide whether the remaining evidence needs sections or can stay context-only.

### Step 3 — Produce The Semantic Payload

Reuse existing knowledge before inventing new Nodes: use `context mdrive glossary match <name>` and `context mdrive node list --format json` for term/entity reuse.

Apply the procedure in `references/internal-procedures/skill-align-workflow.md` for Node classification gates and structure-decision procedure. Keep generated payloads on stdin. Do not create scratch files under the workspace or `/tmp`.

Use CLI diagnostics instead of static prompt rules:

- `diagnostics.automatic_ownership_adjustments[]` explains mechanical external-reference demotions and the explicit ownership override shape.
- `pending-relation-refs` lists explicit Parent/Children/Related markdown links. Reuse existing target Nodes when present; keep unresolved target slug hints deferred instead of writing dangling `contains_parent`.
- Validation diagnostics identify contiguity, citation eligibility, ownership, and mount-matrix problems.
- `views[]` and `diagnostics` distinguish citable evidence from supporting context; do not infer citation eligibility from raw ownership prose.

### Step 4 — Validate And Submit

When the envelope asks for `validate_align_decision`, submit the structure-decision payload to `context align validate --input - --format json` or the exact returned command. If validate returns blocking diagnostics, repair the payload and rerun validate. If validate returns a `submit_structure_decision` next_action, execute that command with the validated payload.

For any other write kind, execute the top-level `next_action.command` exactly. If the command rejects the payload, follow the returned `next_action` and `reason_code`; do not infer a route fallback from memory.

### Final Report

Report in the user's conversation language. Summarize finalized Node counts and meaningful warnings. Do not surface workflow payload digests, scope ids, block hashes, snapshot digests, or absolute paths.
