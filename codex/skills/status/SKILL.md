---
name: status
description: >
  Print the current workspace overview (sources, raw counts, knowledge counts, last compile) and suggested next actions. Equivalent to Claude /context:status; use the local `context` CLI for workspace writes.
tools:
  - Bash
---

# Status

Public C4A Context entry for agents that expose skills instead of Claude slash commands.

- Public entry: `status`
- Claude equivalent: `/context:status`
- CLI primitive prefix: `context ...`
- Internal procedures live under `references/internal-procedures/`; read each referenced file in full before following that step.

---

## Workflow

Run `context status` from the active workspace root only. `status` is intentionally local-only and does not walk up from child directories. If the CLI reports `workspace-not-found`, relay that error and ask the user to rerun from the workspace root or initialize with `/context:init`; do not probe storage paths to discover a workspace.

Surface the CLI's output verbatim — its trailing suggestions are already actionable. Do not invent additional suggestions; the CLI decides what to recommend based on the workspace state. Typical recommendations you will see:

- Run `/context:align` when there is active raw material but no align plan yet (compile's Stage 1 prerequisite).
- Run `/context:align` when JSON status reports `incremental.pending_align.status: "pending"` with `count > 0`. This structural signal takes precedence over a previous finalized align workflow's compile hint.
- Run `/context:compile` when align plan exists and raw is newer than the last compile.
- Run `/context:capture --code` when the repo is a git checkout but no source-code snapshot has been captured yet.
- Run `context compile --aspect code` when code projection is pending, or `context compile --aspect <name>` when a custom aspect projection is pending. JSON status includes `aspect_projection` and `code_projection` summaries for these deterministic paths.

Recent CLI output may include `incremental.cache_status`, `incremental.pending_align`, and `incremental.pending_compile`. Surface those fields verbatim. If the user asks what they mean, explain that they show the local incremental cache health and queued align/compile work; cache warnings are informational unless the CLI output includes a blocking error or an explicit next action.

Workflow lineage helpers are exposed through `context workflow status --format json` and `context workflow list --format json`. If status returns `current: null` with `last_published`, the published finalized ownership is still the workspace structure truth; compile may continue from it without rerunning align.

If the CLI exits with a workspace-not-found error, stop and invite the user to run `/context:init` instead of guessing a workspace location.

Language policy: surface the CLI output verbatim. Any extra explanation or workspace-not-found invitation follows the user's conversation language; command names, paths, status labels, source-ids, and issue codes stay as printed.
