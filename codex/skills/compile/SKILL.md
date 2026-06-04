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
- **Delegated** — add `--delegated` only when the user explicitly authorized delegated mode at the start of this conversation. Treat requests such as "全托管执行", "全自动托管", "fully managed", "delegated execution", or "use delegated mode" as explicit delegated authorization. Delegated mode records scoped authority for low-risk reconcile/review/apply defaults; it does not auto-draft Node content or replace agent evidence reading. Do not infer it from vague "continue", "继续", or "后面不用问我" permission.

### Core Rules

- Follow top-level `next_action.kind` and `next_action.command` for every write.
- Use `views[].command` for evidence reads, prioritizing `expected: true`.
- Treat `allowed_actions[]` as permission for read-only insertions; it is not a menu of alternate write paths.
- Treat `agent_hints[]`, when present, as a temporary mirror or diagnostic. If it conflicts with `next_action`, follow `next_action`.
- Do not use direct file tools, shell scripts, `jq`, `sed`, `cat`, `head`, `tail`, Python, or Node.js to inspect workspace storage, workflow payload files, or `--format json` stdout.
- Workflow write digest flags are stale guards. Omit `--payload-digest` unless the returned command explicitly requires one; when an explicit digest is needed, use `context workflow show --payload <name> --digest-only --format text` instead of parsing JSON stdout.

Protocol discovery:

- `context schema workflow.next-action-envelope.v2 --view minimal --format json`
- `context protocol show align-compile --format json`
- command-specific `context schema <name> --view minimal --format json`

## Start

1. Run `context compile scan --format json` (or `context compile scan --delegated --format json` when the user explicitly authorized delegated mode, including "全托管执行" / "fully managed").
2. If the scan returns `close_compile`, run the returned close command even when there are no changed Nodes; finalized no-write/container Nodes may still need close materialization.
3. If the scan returns `stop_noop` or no changed work, report that compile stopped before draft and no files were written.
4. Run `context status --view summary --format json` or `context mdrive workspace stats --format json` only when needed for the final before/after report or when the CLI asks for diagnostics. Do not run doctor/status/source-list as a required preflight before following a valid compile scan or align-finalize handoff.

Run `context compile scan` only for this initial preflight unless the CLI explicitly returns it as the next command after a terminal/no-work state. During an active compile workflow, discover the next node from the current envelope (`next_action`, `views[]`, `workset_progress`) and follow returned commands; do not rerun scan between node cycles to probe for the next node.

## Main Loop

Repeat until the CLI returns `stop_noop`, `close_compile` succeeds, or a blocking user question remains.

Carry the latest envelope forward between iterations. After a successful node cycle, continue from its returned `next_action.command` / `workset_progress` rather than restarting at `context compile scan`.

### Step 1 — Read Node Evidence From The Envelope

Run the evidence command returned by the envelope before writing. `views[].expected` identifies the default compact evidence entry, not a separate checklist to exhaust. For compile evidence, prefer the CLI-returned source-ref/scaffold views. They may expose:

- `source_refs_index_command` / `source_refs_command` — compact Node-scoped citation index for drafting; use `items[].block_id` in `source_block_ids[]` when the row is the evidence you will cite. Multiple block ids in one action must be one same-source contiguous citation-eligible run; split around skipped citation-eligible rows or use `--draft-scaffold` when unsure.
- `source_refs_detail_command` — detailed source refs with quote previews; open only when the compact index is not enough.
- `request_full_text_command` / `--view text` — narrow text view for one block when quote preview is not enough; this is still Node-scoped, not a workspace evidence bundle.
- `citable_source_refs[]` — detailed-view refs eligible for draft citations; prefer `block_id` values in `source_block_ids[]`.
- `supporting_context_refs[]` — background/framing only.
- diagnostics such as citation eligibility, coverage, engagement, stale raw/source_ref pointers, and advisory foldbacks.

Follow `page.next_command` for pagination. Use `how_to_explore[]` for narrow reads. Do not expand workflow payloads through host tool-results. Node-cycle receipts are compact by default; `actions_meta[]` exposes current draft action handles for patching without an extra status read. When advisory foldbacks say `agent_recommended_action: ignore`, do not inspect each detail row unless the user asks for cleanup or the cited source appears to lose meaning.

### Step 2 — Produce Payloads Only When Requested

For `submit_compile_cycle`, load the Node evidence via the returned command/views, Read `references/internal-procedures/skill-compile-draft.md` in full and follow it for exactly one Node, and pass the emitted JSON on stdin to the returned `next_action.command`.

Prefer heredocs for small payloads. If large or parallel draft payloads need staging, use the workspace AGENTS.md scratch path (`.context/.tmp/agent-payloads/<run-id>/...` in embedded workspaces, `.tmp/agent-payloads/<run-id>/...` in root-layout workspaces) and redirect stdin from that file. Never reuse fixed names like `/tmp/c4a-draft-<node>.json`, and never use scratch paths as workflow handoff or CLI-managed storage.

Use `op: deprecate` only when an existing active Section is no longer supported by its source, is factually wrong, has been superseded, or the user explicitly asked to retire it. Do not deprecate an existing true Section merely because it is low-relevance to the current narrow task; leave it unchanged and use `op: skip` / omit only for the current proposed evidence.

For `continue_compile_cycle`, do not invoke the draft skill and do not attach `--input`; execute the returned `next_action.command` exactly. `--continue` resumes a saved draft session. If it returns `status: "noop"`, follow the returned `close_compile` next action.

For `patch_compile_draft`, submit only the patch schema requested by the CLI. Use `actions_meta[].action_id` for `replace_action` / `remove_action`, or `add_action` with `before` / `after`; do not use generic `op/path/value` aliases.

For `review_reconcile_decisions`, first inspect the returned command and prepare summary. If the command is `context reconcile review --accept-safe-defaults ...` with no `--decisions -`, run it directly; the CLI is accepting only mechanical defaults. If manual decisions remain, load the prepare payload through CLI views such as `context workflow show --payload prepare --view issues --unwrap --format json`, accept default_decision items with compact `{ item_id, accept_default: true }` when you can verify they are appropriate, and Read `references/internal-procedures/skill-compile-judge.md` in full and follow it only for items that still need support/relation judgment. For hand-authored decision payloads, run `context reconcile validate --mode compile --node <slug> --decisions - --format json`, repair any blocking diagnostics, then pass validated decisions to the returned review command.

Do not treat every `review_reconcile_decisions` envelope as a judge request. Invoke `references/internal-procedures/skill-compile-judge.md` only when the prepare summary includes `judge_handoff` or the returned diagnostics explicitly ask for support/relation judgment. If `questions` are present but `next_action.kind` is `patch_compile_draft`, patch the draft first; do not infer judge mode from question counts.

For `apply_reconcile_review`, execute the returned plain apply command exactly, typically `context reconcile apply --format json`; do not add `--decisions` or stdin. For `close_compile`, `finish_current_node`, `submit_coverage_disposition`, or `abandon_or_rescan`, execute the returned command exactly. If it rejects, follow the new `next_action` and `reason_code`.

### Step 3 — Repair From Diagnostics

Use typed diagnostics as the repair contract:

- `reason_code`, `path`, and `missing[]` identify what to fix.
- `diagnostics.auto_repaired[]` records mechanical repairs; warning severity must be surfaced in the final report.
- `diagnostics.warnings[]` with info/advisory severity are not write blockers unless `blocking: true` or the next action says so.
- `agent_recommended_action` classifies warning handling: `ignore` means continue unless the user asks for cleanup, `respond_optional` means repair only when semantically useful, and `respond_required` means resolve before the returned write action can succeed.
- Raw/source_ref pointer diagnostics are mechanical evidence checks, not content-quality judges. Do not patch drafts only to satisfy URL/style/term-overlap preferences. Blocking evidence checks should come from invalid source refs, stale raw mirrors, changed evidence boundaries, or explicit top-level `next_action`.
- stale prepare refresh returns `review_reconcile_decisions` with `reason_code: "prepare_refreshed"`; reread the new prepare result before reviewing.
- If close reports a finalized Node that needs only block ownership/support repair, use `context compile repair ownership --input - --format json` with the `align.ownership-patch.v2` shape. This is the compile-family repair path and preserves completed node-cycle progress. Do not abandon the active compile workflow just to run `context align patch ownership`.

Do not recover by replaying an old manual path, editing rendered files, or guessing schema aliases.

## Close And Report

When `next_action.kind` is `close_compile`, execute `context compile close` through packaged `references/internal-procedures/skill-compile-close.md` or the returned command. Never claim success unless close exits 0 and verify is green, except the explicit no-work path.

Treat close as a terminal gate, not a blind final step:

- If close reports `code_projection_followup` / `compile-close-code-projection-followup`, run the returned `context compile --aspect code ...` command, then run `context compile close` again before reporting final success.
- If close reports `ready_with_debt`, do not enter export/query/report-as-complete unless the user explicitly accepts the remaining debt. Otherwise repair or skip coverage debt through the returned coverage commands, then run close again.
- Coverage disposition commands mutate workflow state. Run one `context compile coverage ...` command at a time, or use the returned `--skip-unresolved` bulk command for one Node; never submit multiple coverage disposition writes concurrently.
- Use `context query --intent recall` only as a smoke-test query. Do not use recall as a deterministic full-workspace export path.

Report in the user's conversation language. Include semantic apply counts, close/verify status, warning-level `auto_repaired[]`, `ready_with_debt` coverage summaries when present, and before/after workspace totals. Do not surface internal workflow payload digests, source-ref hashes, archive paths, or absolute file paths unless a user-facing report view explicitly returns them.
