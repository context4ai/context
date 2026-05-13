---
description: "Capture URLs, local Markdown, source code, stdin path lists, inbox/refresh sources, or conversation notes as Context sources."
argument-hint: "[url | ./path.md [./more.md...] | --code [path] | --stdin | --inbox | --refresh | note]"
allowed-tools: Bash(context:*, bun:*, brew:*, curl:*, sh:*, scoop:*, choco:*, lark-cli:*), WebFetch
---

Capture documents, source code, notes, inbox files, or refreshed sources into the workspace.

---

## Workflow

Capture is entirely CLI-driven — your role is to route the right `context capture` invocation and relay its output. Never hand-write captured source snapshots: the CLI owns normalisation (NFC, BOM strip, line endings) and the `content_hash` contract, so any manual edit breaks idempotency.

### Code capture dependency preflight

Before any `context capture --code` command, including `--plan`, refresh, or explicit `--module` runs, verify that the TypeScript extraction plugin is installed in the same global package environment as the `context` executable:

```bash
sh -c 'CTX_BIN="$(command -v context)" && node -e "const { createRequire } = require(\"node:module\"); createRequire(process.argv[1]).resolve(\"@c4a/extract-ts\");" "$CTX_BIN"'
```

If the check fails, stop the capture task and surface the CLI's `agent_hints[]` install command (the CLI picks `npm install -g` or `bun install -g` based on how `context` itself was installed). Ask the user once whether to run that command on their behalf; global installs touch shared state, so explicit confirmation is required before invoking `Bash`. If approved, run the exact command from `agent_hints[0].command`, then retry the original `context capture --code ...` invocation. If declined, leave the command visible so the user can run it manually. Do not inline `@c4a/extract-ts`, do not hand-write code snapshots, and do not continue with partial capture.

Invocation note: code capture does not run through `npx`. `context capture --code` resolves `@c4a/extract` and `@c4a/extract-ts` from the installed `@c4a/context-cli` package using Node package resolution, prepares `.context/.cache/aspect-runners/<cacheKey>/c4a-extract-code.mjs`, and executes that wrapper directly. The plugin must therefore be available to the same global install that provides `context`.

### Route by argument

- `$ARGUMENTS` starts with `http://` / `https://` → `context capture $ARGUMENTS` (feishu URLs need `lark-cli`).
- `$ARGUMENTS` is one or more local `.md` paths → local file batch: `context capture <path...>`.
- User provides a long newline-separated path list → pass it to `context capture --stdin` with a direct heredoc.
- `$ARGUMENTS` contains `--inbox` → `context capture --inbox`.
- `$ARGUMENTS` contains `--refresh` → `context capture --refresh`.
- User asks for code capture with explicit `--module` flags → run `context capture --code $ARGUMENTS`, preserving code flags such as `--module`, `--version`, `--version-from`, and `--no-runner-cache`.
- User asks to refresh/re-capture an already configured code source → run `context capture --code` unless the user explicitly wants to change package selection or version flags. The CLI reuses stored `capture_config`, appends a new snapshot only when code/version content changes, and never overwrites prior snapshots.
- User asks for code capture without explicit `--module` flags → first run `context capture --code $ARGUMENTS --plan --format json`.
  - Present only candidate package name, module path, and version. Do not show file counts or the derived path filter.
  - Ask the user which package paths to capture. If the host interaction supports multi-select, allow multi-select; otherwise ask the user to reply with one or more package paths/names.
  - Then run `context capture --code` with one repeated `--module <path>` for every selected package. The CLI derives and stores path filtering silently from that selection.
- User asks to record conversation material, a decision, a revision intent, or a temporary observation → use note capture:
  - Classify once as `revision`, `decision`, or `brainstorm`; temporary observations are `brainstorm`. If unclear, ask one clarification.
  - For `revision` or `decision`, require an existing target. If missing, run `context query --intent node_search <user words>` and ask the user to confirm a Node or Section before writing.
  - Write the body to `context capture --note --intent <intent> --anchor <node-slug>[#<section-id>] --input -` for anchored notes, or omit `--anchor` for brainstorm.
  - For `revision`, organize the stdin Markdown with headings: `旧上下文`, `修改意图`, `新内容`, `验证条件`.
  - For `decision`, organize the stdin Markdown with headings: `议题`, `选项`, `决议`, `理由`.
  - After capture, run `context status --format json` and base the user-facing next step on `next_step.command` / `workflow.next_step`.

For stdin batches, use this shape:

```bash
context capture --stdin <<'EOF'
docs/a.md
docs/b.md
EOF
```

Do not pipe the heredoc through another command, and do not discover files with `find` / `ls` when the user already supplied the paths.

### Output handling

Report the CLI output verbatim. If the CLI reports `N sources changed`, suggest the right next step:

- Run `context status --format json` and use its `next_step.command` / `workflow.next_step`.
- If status says aligned knowledge is missing or alignment is required → suggest `/context-align`.
- If status says compile work is pending for Markdown / evidence-backed knowledge → suggest `/context-compile`. Mention `/context-align` only if the user wants to revise the structure.
- If the capture was code-only and status explains that code compile projection is not available yet, do not suggest `/context-compile`; report that the code-aspect source snapshot was captured and active knowledge generation is a later code projection capability.

Never suggest `/context-compile` when no align plan exists or when the only active source is `aspect:code` raw snapshot data — compile refuses prose-less work and must not be used to hand-build code knowledge.

If capture is rejected with `agent_hints[].code = "workflow-cross-family-rejected"`, do **not** run `context workflow abandon ...` automatically. First run or ask the user to run `context workflow status --format json` and explain that another workflow is active in this workspace. Continue that workflow when it is the intended task; ask the user before abandoning it when the user wants to discard that in-progress work. If the user expected a different repository/workspace, change to the confirmed workspace root before retrying capture.

### Missing dependency recovery

If the CLI returns `agent_hints[]` with `code: "capture-code-typescript-plugin-missing"`, stop and surface the hint. Ask the user once for permission to run `agent_hints[0].command` (the CLI has already picked the correct package manager — `npm install -g` or `bun install -g` — based on how `context` itself was installed). If approved, run that exact command via `Bash` and then retry the original capture; if declined, leave the command visible for manual install. Never substitute a different package manager or version.

If the CLI prints a missing-dependency error like `lark-cli not installed`, walk the user through installation:

1. Ask once up-front whether to proceed with install. If no → stop and tell the user to install manually from the tool's official README, then re-run.
2. `WebFetch` the tool's official README (for `lark-cli` that's `https://github.com/larksuite/cli/blob/main/README.md#quick-start-ai-agent`).
3. For each command the README prescribes for the user's platform, show the command then call `Bash`. The host's per-tool permission prompt is the user's confirmation surface; don't add extra y/n questions between commands.
4. Stop on any failure; surface stderr verbatim.
5. After success, tell the user to re-run their original `/context-*` command themselves.

### Language policy

Your prose to the user follows the user's conversation language. CLI commands, flag names, URLs, env-var names, binary names, source-ids stay English.

### Invariants

- Captured source snapshots are immutable post-write — the CLI only ever appends new snapshots.
- The source registry is authoritative; derived index files are not Agent workflow inputs.
- Local `.md` source identity follows the captured file's stable origin path, not its H1/title. If the user edits the title but captures the same path again, the CLI appends a new snapshot to the same `local:*` source.
- In `--format json`, code capture runner cache state is authoritative in `result.runner.cacheMode`: `prepared` means a workspace runner was prepared, `cached` means workspace cache hit, and `bypass` means `--no-runner-cache` used a temporary runner directory instead of the workspace runner cache.
- Aspect snapshots default to `evidence.mode: none`. Prose-like custom aspects must opt in with `evidence: { mode: block }` in `aspects/<name>/aspect.yaml` before they generate evidence manifests. Invalid `evidence.mode` values are reported as `evidence-policy-invalid`; they are not silently treated as `none`.
- Code aspect snapshots ship with `evidence.mode: none`; symbols/files/edges are indexed inside the code bucket. Do not ask users to inspect or repair a code `.evidence` manifest.
- Code aspect capture does not currently generate active knowledge Nodes. Do not ask users to run `/context-compile` just because no code Nodes appear; that is the expected boundary.
- On duplicate capture of the same URL: identical `content_hash` → CLI skips with `unchanged`; different hash → CLI appends a new snapshot.
