---
name: compile
description: >
  Compile the confirmed align plan into source-linked knowledge through CLI-guided workflow steps. Equivalent to Claude /context:compile; use the local `context` CLI for workspace writes.
tools:
  - Bash
---

# Compile

Public C4A Context entry for agents that expose skills instead of Claude slash commands.

- Public entry: `compile`
- Claude equivalent: `/context:compile`
- CLI primitive prefix: `context ...`
- Internal procedures live under `references/internal-procedures/`; read each referenced file in full before following that step.

---

## Workflow

Synthesize finalized align structure into knowledge. The CLI owns workflow routing, validation, reconciliation, apply, close, payload storage, and recovery commands. The agent reads evidence and emits semantic payloads only when `next_action` asks for them.

Naming convention:

- `/context:*` names user slash commands.
- `context ...` names CLI primitives.
- `context:skill-*` names packaged internal procedures, not user slash commands.

### Modes

- **Default** — follow `context compile scan --format json` and the returned `next_action` until compile is closed or no work remains.
- **`--plan`** — validate per-Node draft changes without closing or writing active knowledge; stop after the planned changes are reported.
- **`--aspect code [selector]`** — run `context compile --aspect code [selector]`, report the CLI result, and stop unless the CLI asks for a follow-up close. The selector may be omitted to process all actionable code sources; when present, the CLI resolves source slug, package name, or module path.
- **`--aspect <name>`** — run deterministic custom aspect projection for one configured aspect. Use `context compile --aspect <name> --allow-large-deprecate` only when the CLI rejected a large deprecate and the user confirms the runner output is intentionally empty or reduced.
- **`--all`** — run `context compile --all` to materialize code projection first and then custom aspect projections in deterministic order.
- **Delegated** — add `--delegated` only when the user explicitly authorized delegated/automatic mode at the start of this conversation. Do not infer it from vague "continue" permission.

### Core Rules

- Follow top-level `next_action.kind` and `next_action.command` for every write.
- Use `views[].command` for evidence reads, prioritizing `expected: true`.
- Treat `allowed_actions[]` as permission for read-only insertions; it is not a menu of alternate write paths.
- Treat `agent_hints[]`, when present, as a temporary mirror or diagnostic. If it conflicts with `next_action`, follow `next_action`.
- Do not use direct file tools, shell scripts, `jq`, `sed`, `cat`, `head`, `tail`, Python, or Node.js to inspect workspace storage, workflow payload files, or `--format json` stdout.

Protocol discovery:

- `context schema workflow.next-action-envelope.v2 --view minimal --format json`
- `context protocol show align-compile --format json`
- command-specific `context schema <name> --view minimal --format json`

## Start

1. Run `context compile scan --format json` (or `context compile scan --delegated --format json` only for explicit delegated mode).
2. If the scan returns `stop_noop` or no changed work, report that compile stopped before draft and no files were written.
3. Run `context status --view summary --format json` or `context mdrive workspace stats --format json` only when needed for the final before/after report or when the CLI asks for diagnostics. Do not run doctor/status/source-list as a required preflight before following a valid compile scan or align-finalize handoff.

Run `context compile scan` only for this initial preflight unless the CLI explicitly returns it as the next command after a terminal/no-work state. During an active compile workflow, discover the next node from the current envelope (`next_action`, `views[]`, `workset_progress`) and follow returned commands; do not rerun scan between node cycles to probe for the next node.

## Main Loop

Repeat until the CLI returns `stop_noop`, `close_compile` succeeds, or a blocking user question remains.

Carry the latest envelope forward between iterations. After a successful node cycle, continue from its returned `next_action.command` / `workset_progress` rather than restarting at `context compile scan`.

### Step 1 — Read Node Evidence From The Envelope

Run the evidence command returned by the envelope before writing. `views[].expected` identifies the default compact evidence entry, not a separate checklist to exhaust. For compile evidence, prefer the CLI-returned source-ref/scaffold views. They may expose:

- `source_refs_index_command` / `source_refs_command` — compact Node-scoped citation index for drafting; use `items[].block_id` in `source_block_ids[]` when the row is the evidence you will cite.
- `source_refs_detail_command` — detailed source refs with quote previews; open only when the compact index is not enough.
- `request_full_text_command` / `--view text` — narrow text view for one block when quote preview is not enough; this is still Node-scoped, not a workspace evidence bundle.
- `citable_source_refs[]` — detailed-view refs eligible for draft citations; prefer `block_id` values in `source_block_ids[]`.
- `supporting_context_refs[]` — background/framing only.
- `required_preserved_literals[]` — URL, code identifier, `source_ref`, or `block_id` literals that must stay visible in the generated content or repair report.
- diagnostics such as citation eligibility, source support, coverage, engagement, and advisory foldbacks.

Follow `page.next_command` for pagination. Use `how_to_explore[]` for narrow reads. Do not expand workflow payloads through host tool-results. Node-cycle receipts are compact by default; `actions_meta[]` exposes current draft action handles for patching without an extra status read. When advisory foldbacks say `agent_recommended_action: ignore`, do not inspect each detail row unless the user asks for cleanup or the cited source appears to lose meaning.

### Step 2 — Produce Payloads Only When Requested

For `submit_compile_cycle`, load the Node evidence via the returned command/views, Read `references/internal-procedures/skill-compile-draft.md` in full and follow it for exactly one Node, and pass the emitted JSON on stdin to the returned `next_action.command`.

Prefer heredocs for small payloads. If large or parallel draft payloads need staging, use the workspace AGENTS.md scratch path (`.context/.tmp/agent-payloads/<run-id>/...` in embedded workspaces, `.tmp/agent-payloads/<run-id>/...` in root-layout workspaces) and redirect stdin from that file. Never reuse fixed names like `/tmp/c4a-draft-<node>.json`, and never use scratch paths as workflow handoff or CLI-managed storage.

For `continue_compile_cycle`, do not invoke the draft skill and do not attach `--input`; execute the returned `next_action.command` exactly. `--continue` resumes a saved draft session. If it returns `status: "noop"`, follow the returned `close_compile` next action.

For `patch_compile_draft`, submit only the patch schema requested by the CLI. Use `actions_meta[].action_id` for `replace_action` / `remove_action`, or `add_action` with `before` / `after`; do not use generic `op/path/value` aliases.

For `review_reconcile_decisions`, load the prepare payload through CLI views such as `context workflow show --payload prepare --unwrap --format json`, Read `references/internal-procedures/skill-compile-judge.md` in full and follow it when semantic judgment is needed, run `context reconcile validate --mode compile --node <slug> --decisions - --format json`, repair any blocking diagnostics, then pass validated decisions to the returned review command.

Invoke `references/internal-procedures/skill-compile-judge.md` only when the top-level `next_action.kind` is exactly `review_reconcile_decisions`. If `questions` are present but `next_action.kind` is `patch_compile_draft`, patch the draft first; do not infer judge mode from question counts.

For `apply_reconcile_review`, execute the returned plain apply command exactly, typically `context reconcile apply --format json`; do not add `--decisions` or stdin. For `close_compile`, `finish_current_node`, `submit_coverage_disposition`, or `abandon_or_rescan`, execute the returned command exactly. If it rejects, follow the new `next_action` and `reason_code`.

### Step 3 — Repair From Diagnostics

Use typed diagnostics as the repair contract:

- `reason_code`, `path`, and `missing[]` identify what to fix.
- `diagnostics.auto_repaired[]` records mechanical repairs; warning severity must be surfaced in the final report.
- `diagnostics.warnings[]` with info/advisory severity are not write blockers unless `blocking: true` or the next action says so.
- `agent_recommended_action` classifies warning handling: `ignore` means continue unless the user asks for cleanup, `respond_optional` means repair only when semantically useful, and `respond_required` means resolve before the returned write action can succeed.
- `source_support` is advisory lexical diagnostics, not a keyword gate. Do not patch drafts only to satisfy term overlap. Blocking evidence checks should come from invalid source refs, changed evidence boundaries, unsupported confirmed hard facts, or explicit top-level `next_action`. URL preservation, section kind precision, example formatting, and summary style are advisory/debt unless the CLI explicitly marks them blocking.
- stale prepare refresh returns `review_reconcile_decisions` with `reason_code: "prepare_refreshed"`; reread the new prepare result before reviewing.

Do not recover by replaying an old manual path, editing rendered files, or guessing schema aliases.

## Close And Report

When `next_action.kind` is `close_compile`, execute `context compile close` through packaged `references/internal-procedures/skill-compile-close.md` or the returned command. Never claim success unless close exits 0 and verify is green, except the explicit no-work path.

Report in the user's conversation language. Include semantic apply counts, close/verify status, warning-level `auto_repaired[]`, `ready_with_debt` coverage/review-debt summaries when present, and before/after workspace totals. Do not surface internal workflow payload digests, source-ref hashes, archive paths, or absolute file paths unless a user-facing report view explicitly returns them.
