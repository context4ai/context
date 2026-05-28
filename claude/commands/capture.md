---
description: "Capture URLs, local Markdown, source code, stdin path lists, inbox/refresh sources, or conversation notes as Context sources."
argument-hint: "[url | ./path.md [./more.md...] | --code [paths...] | --aspect <name...> | --stdin | --inbox | --refresh | note]"
allowed-tools: Bash(context:*, bun:*, brew:*, curl:*, sh:*, scoop:*, choco:*, lark-cli:*), WebFetch
---

<!--
This command has no companion skill. Its protocol (argument routing +
missing-dependency install flow) lives inline here per the slash-command
length exemption for self-contained slash commands.
-->

## Your Task

Capture is entirely CLI-driven — your role is to route the right `context capture` invocation and relay its output. Never hand-write captured source snapshots: the CLI owns normalisation (NFC, BOM strip, line endings) and the `content_hash` contract, so any manual edit breaks idempotency.

### Code capture diagnostics

Do not run hand-written dependency preflight commands before `context capture --code`. The CLI owns TypeScript runner/plugin resolution and returns structured `agent_hints[]` when the runner is missing or misconfigured.

If `context capture --code ...` fails with install or runner hints, surface the CLI's `agent_hints[]` install command exactly as printed. Ask the user once whether to run that command on their behalf; global installs touch shared state, so explicit confirmation is required before invoking `Bash`. If approved, run the exact command from `agent_hints[0].command`, then retry the original `context capture --code ...` invocation. If declined, leave the command visible so the user can run it manually. Do not inline extraction packages, do not hand-write code snapshots, and do not continue with partial capture.

Invocation note: code capture does not run through `npx`. The default code aspect uses the `@c4a/extract` runner and `@c4a/extract-ts` plugin bundled into the installed `@c4a/context-cli`, then records the bundled runner identity in the user-cache manifest. Only non-default runner/plugin packages configured in `aspects/code/aspect.yaml` need to be resolvable from the same global install that provides `context`; when they are missing, the CLI returns structured install hints.

### Route by argument

- `$ARGUMENTS` is one or more `http://` / `https://` targets and/or local `.md` paths → `context capture $ARGUMENTS` (Feishu docx/wiki URLs need `lark-cli`; URL and mixed batches are supported). Do not write an Agent-side URL loop.
- User provides a long newline-separated URL list or local `.md` path list → pass it to `context capture --stdin` with a direct heredoc. Mixed URL + local `.md` batches are supported when the user intentionally provides both.
- `$ARGUMENTS` contains `--inbox` → `context capture --inbox`.
- `$ARGUMENTS` contains `--refresh` → `context capture --refresh`. This refreshes active Feishu URL sources and local Markdown sources whose stored origin file still exists; code sources use `context capture --code`.
- User asks for code capture with explicit `--module` flags → run `context capture --code $ARGUMENTS`, preserving code flags such as `--module`, `--version`, `--version-from`, and `--no-runner-cache`.
- User asks to refresh/re-capture an already configured code source → run `context capture --code` unless the user explicitly wants to change package selection or version flags. The CLI reuses stored `capture_config`, appends a new snapshot only when code/version content changes, and never overwrites prior snapshots.
- User asks to run a configured custom aspect capture → run `context capture --aspect <name...> --format json`. Do not use `context capture --aspect code`; code capture remains `context capture --code` because it owns target path, `--module`, version, and runner-cache flags.
- User provides one or more code target paths, or asks for code capture without explicit `--module` flags → run `context capture --code $ARGUMENTS --format json` directly. The CLI preflights every target first; if any target is ambiguous it returns candidates without writing, otherwise it captures all selected code targets serially.
  - If the CLI returns candidate packages, ask the user which package paths to capture.
  - Then run `context capture --code <original-target-if-present>` with one repeated `--module <path>` for every selected package. The CLI derives and stores path filtering silently from that selection.
- User asks to record conversation material, a decision, a revision intent, or a temporary observation → use note capture:
  - Classify once as `revision`, `decision`, or `brainstorm`; temporary observations are `brainstorm`. If unclear, ask one clarification.
  - For `revision` or `decision`, require an existing target. If missing, run `context query --intent node_lookup --query "<user words>"` and ask the user to confirm a Node or Section before writing.
  - Write the body to `context capture --note --intent <intent> --anchor <node-slug>[#<section-id>] --input -` for anchored notes, or omit `--anchor` for brainstorm.
  - For `revision`, organize the stdin Markdown with headings: `旧上下文`, `修改意图`, `新内容`, `验证条件`.
  - For `decision`, organize the stdin Markdown with headings: `议题`, `选项`, `决议`, `理由`.
  - After capture, run `context status --view summary --format json` and base the user-facing next step on `next_step.command` / `workflow.next_step`.

For stdin batches, use this shape:

```bash
context capture --stdin <<'EOF'
https://example.feishu.cn/wiki/abc
docs/a.md
docs/b.md
EOF
```

Do not pipe the heredoc through another command, and do not discover files with `find` / `ls` when the user already supplied the paths.

### Output Handling

Report the CLI output verbatim. If the CLI reports `N sources changed`, suggest the right next step:

- Run `context status --view summary --format json` and use its `next_step.command` / `workflow.next_step`.
- If JSON status reports `incremental.pending_align.status: "pending"` with `count > 0`, suggest `/context:align` even when a previous finalized align workflow or prose `workflow.next_step` says compile. Newly captured structure work must be routed through align before compile.
- If status says aligned knowledge is missing or alignment is required → suggest `/context:align`.
- If status says compile work is pending for Markdown / evidence-backed knowledge → suggest `/context:compile`. Mention `/context:align` only if the user wants to revise the structure.
- If the capture was code-only and status reports pending code projection, suggest the CLI-owned code route: `context compile --aspect code <source-slug>`, followed by `context compile close` when the CLI asks for close.

Never suggest prose compile or hand-built code knowledge for a code-only source. Code snapshots become active knowledge only through `context compile --aspect code`, which materializes package/category/symbol Nodes deterministically.

If capture is rejected with `agent_hints[].code = "workflow-cross-family-rejected"`, do **not** run `context workflow abandon ...` automatically. First run or ask the user to run `context workflow status --format json` and explain that another workflow is active in this workspace. Continue that workflow when it is the intended task; ask the user before abandoning it when the user wants to discard that in-progress work. If the user expected a different repository/workspace, change to the confirmed workspace root before retrying capture.

## Final Report

Report in the user's conversation language. Translate section headings into the user's language instead of copying the English labels below verbatim. Optimize for human readability: use document titles instead of source ids, package names instead of `aspect:code:*` strings, and human-readable kind labels ("local markdown", "Feishu doc", "code package") instead of internal tokens. Do not surface content hashes, snapshot digests, workflow payload ids, or absolute file paths.

Stable structure:

1. Completion headline. Single line with the action verb plus core counts: how many sources were captured this round, broken down by `new` / `updated` / `unchanged`. Capture data from `context capture ... --format json` `result.summary` (or per-source statuses when no aggregate is returned).
2. Per-source list grouped by status. Show each captured source under one of three groups (`new` / `updated` / `unchanged`); within each group list the document title (`source.title`), kind label, and a short delta indicator for updated sources (for example added/removed line counts when the CLI returns them; otherwise "content changed"). Cache-hit code packages belong in `unchanged`. Omit groups that are empty.
3. Pending workflow signals. When `context status --view summary --format json` reports follow-up work tied to this capture (sources pending align, sources pending compile, refreshed sources pending recompile, code sources pending projection), summarize each as a single line naming the work and which sources are affected. Omit the section entirely when there is no pending follow-up.
4. Next step. Single command suggestion driven by status: `/context:align` when structure work is pending, `/context:compile` when prose compile work is pending, `context compile --aspect code <slug>` when code projection is pending, or `context compile --aspect <name>` when a custom aspect projection is pending. If nothing is pending, say so explicitly.

Do not include raw CLI diagnostics, agent_hints content, schema names, or workflow payload identifiers in the report. Those belong in earlier troubleshooting output, not in the completion summary.

## Reference

### Missing Dependency Recovery

If the CLI returns `agent_hints[]` with `code: "capture-code-typescript-plugin-missing"`, stop and surface the hint. Ask the user once for permission to run `agent_hints[0].command` (the CLI has already picked the correct package manager — `npm install -g` or `bun install -g` — based on how `context` itself was installed). If approved, run that exact command via `Bash` and then retry the original capture; if declined, leave the command visible for manual install. Never substitute a different package manager or version.

If the CLI prints a missing-dependency error like `lark-cli not installed`, walk the user through installation:

1. Ask once up-front whether to proceed with install. If no → stop and tell the user to install manually from the tool's official README, then re-run.
2. `WebFetch` the tool's official README (for `lark-cli` that's `https://github.com/larksuite/cli/blob/main/README.md#quick-start-ai-agent`).
3. For each command the README prescribes for the user's platform, show the command then call `Bash`. The host's per-tool permission prompt is the user's confirmation surface; don't add extra y/n questions between commands.
4. Stop on any failure; surface stderr verbatim.
5. After success, tell the user to re-run their original `/context:*` command themselves.

### Language Policy

Your prose to the user follows the user's conversation language. CLI commands, flag names, URLs, env-var names, binary names, source-ids stay English.

### Invariants

- Captured source snapshots are immutable post-write — the CLI only ever appends new snapshots.
- The source registry is authoritative; derived index files are not Agent workflow inputs.
- Local `.md` source identity follows the captured file's stable origin path, not its H1/title. If the user edits the title but captures the same path again, the CLI appends a new snapshot to the same `local:*` source.
- In `--format json`, code capture runner cache state is authoritative in `result.runner.cacheMode`: `prepared` means a workspace runner was prepared, `cached` means workspace cache hit, and `bypass` means `--no-runner-cache` used a temporary runner directory instead of the workspace runner cache.
- Aspect snapshots default to `evidence.mode: none`. Prose-like custom aspects must opt in with `evidence: { mode: block }` in `aspects/<name>/aspect.yaml` before they generate evidence manifests. Invalid `evidence.mode` values are reported as `evidence-policy-invalid`; they are not silently treated as `none`.
- Code aspect snapshots ship with `evidence.mode: none`; symbols/files/edges are indexed inside the code bucket. Do not ask users to inspect or repair a code `.evidence` manifest.
- Code aspect capture writes raw code snapshots first. Materialize them with `context compile --aspect code <slug>` (or no slug for all actionable code sources) before prose align needs to attach documentation to code Nodes.
- On duplicate capture of the same URL: identical `content_hash` → CLI skips with `unchanged`; different hash → CLI appends a new snapshot.
