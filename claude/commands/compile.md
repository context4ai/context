---
description: "Compile the confirmed align plan into source-linked knowledge through CLI-guided workflow steps."
argument-hint: "[--plan|code <slug>]"
allowed-tools: Bash(context:*)
---

## Your Task

Synthesize finalized align structure into knowledge. The CLI owns workflow routing, validation, reconciliation, apply, close, payload storage, and recovery commands. The agent reads evidence and emits semantic payloads only when `next_action` asks for them.

Naming convention:

- `/context:*` names user slash commands.
- `context ...` names CLI primitives.
- `context:skill-*` names packaged internal procedures, not user slash commands.

### Modes

- **Default** — follow `context compile scan --format json` and the returned `next_action` until compile is closed or no work remains.
- **`--plan`** — validate per-Node draft changes without closing or writing active knowledge; stop after the planned changes are reported.
- **`code [selector]`** — run `context compile code [selector]`, report the CLI result, and stop unless the CLI asks for a follow-up close. The selector may be omitted to process all actionable code sources; when present, the CLI resolves source slug, package name, or module path.
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

## Preflight

1. Run `context doctor`. If output-align errors block compile, tell the user to run `/context:align` and stop.
2. Run `context status --format json` and `context mdrive workspace stats --format json` for before/after reporting.
3. Run `context compile scan --format json` (or `context compile scan --delegated --format json` only for explicit delegated mode).
4. If the scan returns `stop_noop` or no changed work, report that compile stopped before draft and no files were written.

## Main Loop

Repeat until the CLI returns `stop_noop`, `close_compile` succeeds, or a blocking user question remains.

### Step 1 — Read Expected Views

Run expected view commands from the envelope before writing. For compile evidence, prefer the CLI-returned source-ref/scaffold views. They may expose:

- `citable_source_refs[]` — the only refs eligible for draft `source_refs`.
- `supporting_context_refs[]` — background/framing only.
- `required_preserved_literals[]` — URL, code identifier, `source_ref`, or `block_id` literals that must stay visible in the generated content or repair report.
- diagnostics such as citation eligibility, source support, coverage, engagement, and advisory foldbacks.

Follow `page.next_command` for pagination. Use `how_to_explore[]` for narrow reads. Do not expand workflow payloads through host tool-results. Node-cycle receipts are compact by default; `actions_meta[]` exposes current draft action handles for patching without an extra status read.

### Step 2 — Produce Payloads Only When Requested

For `submit_compile_cycle`, load the Node evidence via the returned command/views, invoke packaged `context:skill-compile-draft` for exactly one Node, and pass the emitted JSON on stdin to the returned `next_action.command`.

For `continue_compile_cycle`, do not invoke the draft skill and do not attach `--input`; execute the returned `next_action.command` exactly. `--continue` resumes a saved draft session. If it returns `status: "noop"`, follow the returned `close_compile` next action.

For `patch_compile_draft`, submit only the patch schema requested by the CLI. Use `actions_meta[].action_id` for `replace_action` / `remove_action`, or `add_action` with `before` / `after`; do not use generic `op/path/value` aliases.

For `review_reconcile_decisions`, load the prepare payload through CLI views such as `context workflow show --payload prepare --unwrap --format json`, invoke packaged `context:skill-compile-judge` when semantic judgment is needed, run `context reconcile validate --mode compile --node <slug> --decisions - --format json`, repair any blocking diagnostics, then pass validated decisions to the returned review command.

Invoke `context:skill-compile-judge` only when the top-level `next_action.kind` is exactly `review_reconcile_decisions`. If `questions` are present but `next_action.kind` is `patch_compile_draft`, patch the draft first; do not infer judge mode from question counts.

For `apply_reconcile_review`, `close_compile`, `finish_current_node`, `submit_coverage_disposition`, or `abandon_or_rescan`, execute the returned command exactly. If it rejects, follow the new `next_action` and `reason_code`.

### Step 3 — Repair From Diagnostics

Use typed diagnostics as the repair contract:

- `reason_code`, `path`, and `missing[]` identify what to fix.
- `diagnostics.auto_repaired[]` records mechanical repairs; warning severity must be surfaced in the final report.
- `diagnostics.warnings[]` with info/advisory severity are not write blockers unless `blocking: true` or the next action says so.
- stale prepare refresh returns `review_reconcile_decisions` with `reason_code: "prepare_refreshed"`; reread the new prepare result before reviewing.

Do not recover by replaying an old manual path, editing rendered files, or guessing schema aliases.

## Close And Report

When `next_action.kind` is `close_compile`, execute `context compile close` through packaged `context:skill-compile-close` or the returned command. Never claim success unless close exits 0 and verify is green, except the explicit no-work path.

Report in the user's conversation language. Include semantic apply counts, close/verify status, warning-level `auto_repaired[]`, and before/after workspace totals. Do not surface internal workflow payload digests, source-ref hashes, archive paths, or absolute file paths unless a user-facing report view explicitly returns them.
