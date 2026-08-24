---
description: "Build or continue structured, traceable Agent knowledge from documents and code."
argument-hint: "[project-dir or user intent]"
allowed-tools: Bash(context:*), Bash(bun:*), Bash(cd *)
---

## Your Task

Context is a knowledge management tool built for Agent knowledge workflows. It
compiles Feishu/Lark documents, local Markdown, repository code, and manually
curated business material into structured, traceable knowledge, then produces
knowledge packages, LLM-ready documents, or Agent Skills. The CLI packages all
workflow guidance, knowledge-building procedures, and code-indexing capabilities
needed to produce that knowledge; follow its returned commands and resources
for the next action.

Use this as the single conversational entry for Context. Let the CLI locate an
existing workspace, relocate into it, initialize a requested workspace, or
evaluate its current workflow. Do not infer the workspace state yourself.

### Enter the workspace

Run:

```bash
context entry [project-dir] --language <language> --format json
```

Use the user's explicit language choice when present; otherwise pass `zh-CN`
for a Chinese conversation and `en` for an English conversation. Pass
`project-dir`, `--name`, `--dev`, or `--debug` only when the user explicitly
requested that initialization choice. New workspaces enable conservative
document compilation optimization by default. Pass `--no-optimize-docs` only
when the user explicitly asks to disable it during initialization. Pass
`--managed` only after the user explicitly authorizes fully managed operation
in this conversation.

If the `context` process itself cannot start because the command is missing
(`ENOENT`, or shell exit 127 explicitly identifying `context` as the missing
command, such as `command not found: context` or `context: command not found`),
explain that the global CLI is not installed and ask the user to install or
authorize installation with:

```bash
npm install -g @c4a/context-cli@latest
context plugin install
```

Stop after giving that recovery. Do not run an installation preflight, install
automatically, or mistake a normal Context `not found` diagnostic for a missing
executable.

Execute only `next_action.command` returned by `context entry`:

- `initialize-workspace` writes a new workspace. Execute it immediately only
  when the user explicitly requested initialization through this entry;
  otherwise explain the target root and ask for confirmation. Preserve the
  `init-target-nonempty` confirmation.
- `enter-workspace` and `evaluate-workflow` are read-only and need no additional
  confirmation.
- After initialization, execute the exact setup command returned by `context
  init`, enter the project root, read the generated `AGENTS.md`, and run this
  entry again.

If the user explicitly asks to correct or revise an existing approved or built
knowledge page, first let `context entry` relocate into the existing workspace
and evaluate its current Route once. Resolve a blocking workspace diagnostic,
evidence-maintenance action, or already-pending Review batch first; these may
change the approved baseline. Before continuing unrelated capture, extraction,
package configuration, or build work, start the correction with:

```bash
context revise "<the user's page title, approved path, ViewRef, or wording>" --format json
```

When the target is unique, run the returned status command and follow
`route.document-revision.requested`. When candidates are returned, select one
only if the conversation identifies it uniquely; otherwise ask which page the
user means. Never edit the approved base page or `dist/` for this operation.
After the Route validates the revision, continue normally: Context will offer
the package build when the correction makes its output stale.

### Conversation modes

Enable debugging only when the user explicitly requests it. If initialization
is required, pass `--debug` to `context entry` and execute its returned
`context init ... --debug` command; do not run a workspace-only debug command
before initialization. For an existing workspace, run `context debug enable`
before workflow evaluation. Debugging records traces below
`.tmp/context-runtime/debug/` but does not grant workflow authority or provide
source evidence.

Document optimization is enabled by default for newly initialized workspaces.
It conservatively repairs formatting, Markdown, links, and obvious local errors
without broadly rewriting source-backed prose. It keeps approved pages
source-faithful and stores only changed full-page revisions beside them as
`knowledge/**/*__revision.md`. Default knowledge discovery excludes those
reserved sidecars; validation and package compilation apply them to the
matching base page.

For an existing workspace, respect its current `package.json` setting. Run
`context optimize-docs enable` or `context optimize-docs disable` only when the
user explicitly changes that preference. If initialization is required and the
user opts out, pass `--no-optimize-docs` through `context entry`; otherwise let
the default initialization command enable it.
Follow the resulting Route instead of editing approved knowledge or package
output by hand.

For explicitly authorized fully managed operation, use:

```bash
context run --managed --until blocked-or-complete --format json
```

Use `--managed` for every resumed workflow evaluation in the same active
request. Never persist or reuse that authority in another conversation, and
stop using it when the conversation ends or the user revokes it. Pass any
additional `--authority` only when the user explicitly grants that authority in
this conversation.

The managed loop executes only Route-selected work and returns the current
`workflow.current` whenever Agent reading, project configuration, a human Gate,
host execution, diagnostics, or a non-unique plan needs attention. Resume from
that returned Route; never reconstruct a command from an earlier step.

### Follow the current Route

Treat `workflow.current` as the current-step authority:

1. Read every `resources.required` item whose `read_state` is `read-required`.
   Read a returned `path` completely, or execute a returned resource `command`
   and read its complete output file. Materializing a resource is not reading
   it. Keep the merged receipts only in this conversation and submit them with
   the exact returned `context status --resource-receipts @<file>` command. Use
   `after_read_receipts` only after the full resource has been read. The exact
   `resources.after_read.command` already returns the re-evaluated
   `workflow.current`; continue from it without an additional status call.
2. At a Gate, keep inspection and resolution phase-local. Read an
   `inspection_action` resource only while inspecting the decision, and read a
   `resolution_action` resource only after the user confirms the Gate. Neither
   replaces ordinary required resources.
3. Execute only `commands` returned by the Route, preserving revision and
   authority flags exactly. A command marked `after-human-confirmation` waits
   for the current Gate decision. Run a command whose `execution.target` is `agent-host`
   as an exact top-level host action with the required host access,
   not inside a restricted child sandbox. Follow the Route-selected procedure
   for its audit and approval contract; never invent a payload, destination, or
   substitute command.
   Treat a code-extraction batch preview as one Route action. Read its complete
   index-unit report and keep same-kind capability or scale decisions in the
   single returned Gate; do not ask about modules one by one. A non-delegatable
   extraction Gate must stop even in fully managed mode.
4. If `configuration` is present, edit only the named project file and use the
   selected resources as its contract.
5. After every action or configuration change, run status again. The managed
   loop performs this re-evaluation internally. A phase-local `next_action` can
   continue that operation but never replaces the workspace Route.

Explain, ask, confirm, and summarize in the user's current conversation
language. Keep commands, flags, paths, ids, status values, JSONL keys,
`source_ref` values, and copied CLI tokens unchanged.

When the user explicitly asks to publish a completed build, treat publication
as a downstream distribution step outside the Context Route. Use only an
explicitly installed distribution tool and its documented complete-output
upload command. If no such tool is available, stop after the local build and
explain that Context itself does not publish to a hosted service.

Do not infer repo sources, extraction scope, review decisions, or package output
choices from surrounding files. Do not call source-repo operations such as
clone, checkout, reset, fetch, install, build, or test without explicit user
approval.
