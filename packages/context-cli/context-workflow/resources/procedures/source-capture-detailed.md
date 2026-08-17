---
id: procedure.source-capture-detailed
kind: procedure
media-type: text/markdown
context_resource: procedures/source-capture-detailed
name: capture-source
description: >
  Capture local Markdown or Lark/Feishu document sources through registered
  Context sources and declared capture phases. Use the local `context` CLI for
  workspace writes.
tools:
  - Bash
---

# Capture

Current capture discipline for document sources. The executable path is source
registration plus the declared capture phase flow:

- local Markdown/MDX file source: `context source add file [YYYYMMDD] --module <module> --local <path>`
  followed by `context run capture:file:YYYYMMDD/<module> --format json`;
- Lark/Feishu source: `context source add lark [YYYYMMDD] --module <module> ...`
  followed by `context run capture:lark:YYYYMMDD/<module> --format json`;
- refresh: rerun the same declared capture phase after status or the user asks
  for recapture.

Use only commands surfaced by the current status output or capture phase.
For a user-confirmed multi-document batch, `context status --format json`
selects the next uncaptured module in `workflow.current.commands`. Execute the
returned command, reevaluate, and continue until the route leaves capture; a
successful module is omitted from the next status result.
When the user explicitly asks to capture, ingest, fetch, read, or include exact
file/Lark paths or URLs, that request is the read permission for those sources;
do not repeat the question after registration. A mere mention, possible-source
discussion, or register-only request is not permission, and an explicit refusal
always wins.
Register several file/Lark/repo sources with `context source add batch [date]
--input <yaml|json|->`; do not launch multiple `source add` processes in
parallel. Repo batch items require `module`; file/Lark items may omit it and use
the module returned by the CLI. A write-lock error means another Context mutation is active: wait for
it to finish and retry rather than editing registry files.

---

## Workflow

Capture is entirely CLI-driven — your role is to register the right source,
declare the matching capture phase, run the current `context run capture:*`
command, and preserve its machine fields while summarizing the outcome in the
user's language. Never hand-write captured source snapshots: the
CLI owns normalisation (NFC, BOM strip, line endings) and the `content_hash`
contract, so any manual edit breaks idempotency.

Lark capture obtains the structured XML representation and produces two
separate artifacts: XML audit evidence and a deterministic readable Markdown
projection. Do not treat raw XML as Markdown and do not rewrite it yourself.
The CLI also materializes supported embedded resources and returns a closed
`resource_materialization` report. Required images, attachments, Sheets, Bases,
whiteboards, diagrams, and synced blocks must be materialized before downstream
Review. Polls and navigation references remain explicit non-interactive
projections; video is reference-only unless the project SDK opts into bundling.
If the remote API explicitly confirms that a referenced whiteboard or diagram
no longer exists, preserve the unresolved placeholder and the structured
`document.resource.source-missing` warning, then continue through the Route.
This is an audited source-side deletion, not successful materialization. Access,
network, parameter, and unknown resource failures still block downstream work.
Do not manually download resources or patch links. Approved resources move to
`knowledge/assets/`, and package build projects selected resources to
`others/assets/`.
Inspect `evidence_status` and `projection_status` separately. An evidence error
means the source body, external content, or a stable resource locator could not
be preserved, so the workflow must not proceed to Align, Compile, or Review.
A projection warning or `generic` status means the original XML is preserved
and a deterministic non-interactive Markdown fallback was emitted; report the
diagnostic, but continue through the Route. The CLI, not the plugin, parses the
document. The plugin only displays the structured counts and diagnostics
returned by the current source resource. Do not patch the CLI or edit snapshots
to add a renderer from a user workspace.

### Code capture diagnostics

Do not run hand-written dependency preflight commands before code extraction or
document capture. The CLI owns configured runner/plugin resolution and returns
structured `agent_hints[]` when a runner or remote-document helper is missing or
misconfigured.

If code extraction capture fails with install or runner hints, surface the CLI's `agent_hints[]` command exactly as printed. Ask the user once whether to run that command on their behalf when it touches shared state. If approved, run the exact command from `agent_hints[0].command`, then retry the same capture command. If declined, leave the command visible so the user can run it manually. Do not inline extraction packages, do not hand-write code snapshots, and do not continue with partial capture.

Invocation note: document capture and code extraction do not run through `npx`.
Use the installed `context` CLI and the declared phase command returned by
`context status` or the phase view. When external helpers are missing, surface
the CLI's structured install hints instead of substituting your own package
manager or version.

### Route by source boundary

Before choosing a local Markdown capture route, honor the surrounding task context. Driver documents such as run instructions, handbooks, READMEs, plans, feedback issues, corpus/index/manifests, and batch lists are not Context sources unless the user explicitly asks to ingest them. Capture only ingest targets that are already explicit in the user request; if they are missing, ask one clarification instead of capturing the driver document.

- One or more local `.md` / `.mdx` files or a local documentation folder to ingest →
  register one file source with the user-confirmed boundary:
  `context source add file [YYYYMMDD] --module <module> --local <file-or-folder>`.
  The CLI returns the `YYYYMMDD/module` identity to use in project phases. More
  than one file module may share the date. For an explicit
  batch inside a broader folder, preserve the user's include list on source
  registration. Default file capture handles `.md`. If the CLI reports
  document-site files such as `.mdx`, `_meta.json`, sidebars, or docs config,
  stop and confirm whether the selected boundary is a documentation site before
  changing capture configuration. For MDX documentation sites that use
  `_meta.json`, declare `mdxJsonDocs()` on `captureFile` in `src/index.ts`;
  keep `_meta.json` only when it is route metadata for the selected document
  folder. The CLI captures it as metadata and generates
  `__context_route_metadata.md` as mechanical route evidence; it also extracts
  static MDX component props/children into `__context_mdx_component_text.md`
  when components carry user-facing text. Declare
  `captureFile({ source: source("<date>", "<module>", { type: "file" }), processor: mdxJsonDocs() })`, then
  run `context run capture:file:<date>/<module> --format json`. If the selected MDX page
  is empty or only mounts runtime-rendered content, tell the user that capture
  found a document-site shell and ask for the rendered-site or data-source
  boundary instead of inventing body text.
- A Lark/Feishu URL, doc token, or wiki token → register one Lark source:
  `context source add lark [YYYYMMDD] --module <module> --url <url>` or the
  matching token flag. Register every requested document under the same date;
  do not ask for `YYYYMMDD-2`. Declare
  `captureLark({ source: source("<date>", "<module>", { type: "lark" }) })`,
  then run `context run capture:lark:<date>/<module> --format json`.
- Mixed local document and Lark document batches are separate sources unless
  the current CLI explicitly offers a combined source contract. Do not write an
  Agent-side URL/file loop.
- Refresh or recapture request for an already registered file/Lark source →
  rerun the same declared capture phase. The CLI appends a new snapshot only
  when content changes and never overwrites prior snapshots.
- Code package extraction is not document capture. Route code source selection
  through the current code-extraction Route, its selected procedure, and the
  declared extract phase. Do not invent a document capture path for code.
- Conversation notes, decisions, and revision intents are not document capture
  sources in the current workflow unless the CLI status or project-specific
  phase exposes an explicit note source contract. If absent, record the user
  guidance in the conversation and use it as pre-align hints, not as a snapshot
  write.

Do not discover files with `find` / `ls` when the user already supplied paths.
If the include set is large, summarize it and ask for confirmation before
registration; do not read file bodies before capture permission is clear.

### Output Handling

Preserve commands, reason codes, ids, and diagnostics exactly; summarize
successful capture results for the user instead of dumping raw JSON. After any
capture result:

- Run `context status --format json` and treat `workflow.current` as the
  current-step authority; if the route returns `configuration`, perform only
  that declared project edit and rerun status.
- If `workflow.current.commands` contains another capture command for the
  confirmed batch, execute it before asking another naming, collection, or
  read-permission question.
- If the current Route selects align, compile, Review, or code extraction,
  follow only that Route's commands and required resources. Do not branch on
  deprecated top-level `needs-*` status names.
- If `workflow.current` is a Gate, use its `inspection_action` and selected
  dialogue resource before requesting a decision. Read an Inspection Action's
  nested Skill or Schema only when performing that inspection. After explicit
  confirmation, use the `resolution_action` command and load only that Action's
  nested Skill or Schema. These conditional resources are intentionally absent
  from the Route's ordinary `resources.required`.

Never suggest prose compile or hand-built document knowledge for a code-only
source. Code sources become active knowledge only through the declared
extraction/review route returned by `context status`.

If capture is rejected because another phase or write gate is active, do not
discard it automatically. Explain the active state from `context status`, follow
that phase when it is the intended task, and ask the user before discarding
in-progress work when a current project command exists. If the user expected a
different repository/workspace, change to the confirmed workspace root before
retrying capture.

## Final Report

Report in the user's conversation language. Translate section headings into the user's language instead of copying the English labels below verbatim. Optimize for human readability: use document titles instead of source ids, package names instead of internal source id strings, and human-readable kind labels ("local markdown", "Feishu doc", "code package") instead of internal tokens. Do not surface content hashes, snapshot digests, internal payload identifiers, or absolute file paths.

Stable structure:

1. Completion headline. Single line with the action verb plus core counts: how
   many sources were captured this round, broken down by `new` / `updated` /
   `unchanged`. Capture data from the current `context run capture:* --format
   json` result summary, or per-source statuses when no aggregate is returned.
2. Per-source list grouped by status. Show each captured source under one of three groups (`new` / `updated` / `unchanged`); within each group list the document title (`source.title`), kind label, and a short delta indicator for updated sources (for example added/removed line counts when the CLI returns them; otherwise "content changed"). Cache-hit code packages belong in `unchanged`. Omit groups that are empty.
3. Pending phase signals. When `context status --format json` reports follow-up
   work tied to this capture (sources pending align, sources pending compile,
   refreshed sources pending recompile, code sources pending projection),
   summarize each as a single line naming the work and which sources are
   affected. Omit the section entirely when there is no pending follow-up.
4. Next step. Single command suggestion driven by status: the returned
   `context run align:<type>:<source>:<collection> ...` command when structure work is
   pending, the returned `context run compile:<type>:<source>:<collection> ...`
   command when prose compile work is pending, or the CLI-owned code projection
   command when code projection is pending. If nothing is pending, say so
   explicitly.

Do not include raw CLI diagnostics, agent_hints content, schema names, or phase
payload identifiers in the report. Those belong in earlier troubleshooting
output, not in the completion summary.

## Reference

### Missing Dependency Recovery

If the CLI returns `agent_hints[]` for a missing code runner or plugin package, stop and surface the hint. Ask the user once for permission to run `agent_hints[0].command` (the CLI has already picked the correct package manager — `npm install -g` or `bun install -g` — based on how `context` itself was installed). If approved, run that exact command via `Bash` and then retry the same capture; if declined, leave the command visible for manual install. Never substitute a different package manager or version.

If the CLI prints a missing-dependency error like `lark-cli not installed`, walk the user through installation:

1. Ask once up-front whether to proceed with install. If no → stop and tell the user to install manually from the tool's official README, then re-run.
2. `WebFetch` the tool's official README (for `lark-cli` that's `https://github.com/larksuite/cli/blob/main/README.md#quick-start-ai-agent`).
3. For each command the README prescribes for the user's platform, show the command then call `Bash`. The host's per-tool permission prompt is the user's confirmation surface; don't add extra y/n questions between commands.
4. Stop on any failure; surface stderr verbatim.
5. After success, tell the user to rerun the current Context command that
   failed.

### Language Policy

Your prose to the user follows the user's conversation language. CLI commands, flag names, URLs, env-var names, binary names, source-ids stay English.

### Invariants

- Captured source snapshots are immutable post-write — the CLI only ever appends new snapshots.
- The source registry is authoritative; derived index files are not Agent phase
  inputs.
- Local `.md` / `.mdx` source identity follows the captured file's stable origin path, not its H1/title. If the user edits the title but captures the same path again, the CLI appends a new snapshot to the same `local:*` source.
- In `--format json`, code capture runner cache state is authoritative in `result.runner.cacheMode`: `prepared` means a workspace runner was prepared, `cached` means workspace cache hit, and `bypass` means `--no-runner-cache` used a temporary runner directory instead of the workspace runner cache.
- Code extraction runner evidence is derived by the CLI from emitted source files. Do not ask users to configure `evidence.mode`; rerun capture after fixing the runner emit output.
- Code extraction snapshots ship with `evidence.mode: none`; symbols/files/edges are indexed inside the code bucket. Do not ask users to inspect or repair a code `.evidence` manifest.
- Code extraction/projection is separate from document capture. Materialize code
  knowledge through the declared extract/code projection flow before prose align
  attaches documentation to code Nodes.
- On duplicate capture of the same URL: identical `content_hash` → CLI skips with `unchanged`; different hash → CLI appends a new snapshot.
