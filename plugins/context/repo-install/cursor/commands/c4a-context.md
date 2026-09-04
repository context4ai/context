---
description: "Build or continue structured, traceable Agent knowledge from documents and code. Use the local `context` CLI for workspace writes."
---

Start or continue a C4A Context knowledge workspace.

---

## Workflow

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

If the request does not already choose ordinary review or fully managed
operation, first use the read-only entry result to state a short execution
plan, then ask the user to choose once. Explain that ordinary review pauses at
human Gates and presents HTML reports, while fully managed operation resolves
delegatable Gates within this conversation but still stops for permissions,
hard validation, or non-delegatable decisions. Prefer the host's native choice
UI. When initialization already needs a confirmation or missing option, combine
the mode choice with that question instead of adding another round. Keep the
answer only in this conversation and do not ask again after initialization,
capture, or resume. An explicit request for review, human confirmation, fully
managed work, or no further review already resolves this choice.

Use the user's explicit language choice when present; otherwise pass `zh-CN`
for a Chinese conversation and `en` for an English conversation. Pass
`project-dir`, `--name`, `--dev`, or `--debug` only when the user explicitly
requested that initialization choice. Pass `--managed` only after the user
explicitly authorizes fully managed operation in this conversation.

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

If the user asks to correct a current Candidate before approval, first let
`context entry` relocate into the workspace and evaluate its current Route.
Start the correction with:

```bash
context revise "<candidate title, path, or id>" --instruction "<requested correction>" --format json
```

When the target is unique, Context invalidates only its derived outputs and
reopens the owning Author workset. Run the returned status command and follow
the current Route. If the target is ambiguous, ask which Candidate the user
means. Never edit `knowledge/`, `dist/`, or create a side-channel revision page.

### Conversation modes

Enable debugging only when the user explicitly requests it. If initialization
is required, pass `--debug` to `context entry` and execute its returned
`context init ... --debug` command; do not run a workspace-only debug command
before initialization. For an existing workspace, run `context debug enable`
before workflow evaluation. Debugging records traces below
`.tmp/context-runtime/debug/` but does not grant workflow authority or provide
source evidence.

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

Code knowledge is published under `codeindex`. Context mechanically audits each
module's input analysis, stable boundaries, facts, explanation, evidence scope,
and page shape without producing a total score. Blocking mechanical failures
reopen the owning Author or Composer workset; advisory metrics remain warnings
and do not create a retry ledger or override Gate. If a legacy workspace returns
`route.extract.codeindex-migration-required`, execute only its migration
command; do not rename `codegraph` paths manually.

### Discover Indexer Providers before selection

For `indexer-provider-required`, `indexer-provider-unavailable`,
`indexer-customization-required`, `indexer-customization-invalid`, or
`indexer-customization-upstream-changed`, read
`node_modules/@c4a/context/docs/guides/indexer-provider-and-customization.md`
before proposing a selection or project change. It defines the registry-only
default, six-level customization ladder, upgrade conflict handling, debugging
commands, and the exit condition for each level. Do not replace it with a
remembered or host-specific workflow.

When the current Route starts a new Code or Markdown indexing task, its
`configure-indexer-providers` Action input already contains the exact applied
requirements and CLI-bundled Provider catalog. Report those bundled entries
together with every other Indexer Skill already visible through the current
host. The conversational report must
include each Skill name, readable exact version when available, and source type
(CLI-bundled community, workspace, installed plugin, or authorized marketplace
result). When the host already exposes an exact Skill root or `SKILL.md` path,
read only its YAML frontmatter and sibling `context-indexer.yaml` during
discovery. The manifest version is authoritative;
`metadata.context-provider-version` is a readable copy that must match it. Do
not load the Provider body or other guidance until the Route selects it. If the
host exposes no readable root or exact version, report the version as
unavailable rather than guessing it.

Group observations with the same Skill name and exact version into one
conversational item and list all observed source types on that item. An
installed projection of an identical CLI-bundled identity is not a second
Provider. Keep different versions separate; never use source count or discovery order as
selection precedence. Do not search arbitrary directories, infer host cache
paths, install a plugin, or query a marketplace unless the user separately
authorizes it. Keep this discovery report only in the conversation: do not
write it to `src/`, `package.json`, lifecycle state, receipts, audit output, or
`dist/`. Do not repeat it during an unchanged task resume; repeat it only for a
new indexing task, a changed host-visible Skill set, or an explicit diagnostic
request.

Return only `stage: provider-selection`, the non-CLI
`host_visible_skills`, and the selected semantic `indexers` through the exact
`context action complete-current` command returned by the Route. The CLI owns
construction of the full registry payload, fallback/conflict checks, static
validation, Provider resolution and staging, final validation, and atomic
application of `src/indexers.yaml`. Do not call their low-level commands as a
second production workflow.

If a selected external Provider needs Host resolution, the next current Route
contains one `context.resolve-indexer-provider/v1` Host Action and its exact
request. Invoke that Host Action once, then submit
`stage: provider-resolution` with the returned Host result through the Route's
`complete-current` command. If the Bundle carries a non-allowlisted program,
the following current Route presents the existing program-execution Gate; wait
for its user/session-authority decision and submit that decision through
`complete-current`. A recovered `provider-finalization` Route consumes
only its fixed Action input; it must not resolve or install the Provider again.

### Follow the current Route

Treat `workflow.current` as the current-step authority:

1. Read every `resources.required` item whose `read_state` is `read-required`.
   Read a returned `path` completely, or execute a returned resource `command`
   and read its complete output file. For a current Indexer Partition, Author,
   Composer or structure-review Route, read the materialized files and then use
   the Route's immediate completion command; do not create or submit a read
   receipt. Other workflow resources may still require the returned receipt
   command. Materializing a resource is not reading it. Keep those receipts only
   in this conversation and submit them with
   the exact returned `context status --resource-receipts @<file>` command. Use
   `after_read_receipts` only after the full resource has been read. The exact
   `resources.after_read.command` already returns the re-evaluated
   `workflow.current`; continue from it without an additional status call.
2. At a Gate, keep inspection and resolution phase-local. Read an
   `inspection_action` resource only while inspecting the decision, and read a
   `resolution_action` resource only after the user confirms the Gate. Neither
   replaces ordinary required resources.
   For ordinary Knowledge Review, follow the Route-selected dialogue: do not
   advertise force approval in the initial prompt. If the user cannot access
   the report, only their exact current-conversation reply `强制批准` authorizes
   the returned force-approval resolution command; generic approval wording
   does not.
3. Execute only `commands` returned by the Route, preserving revision and
   authority flags exactly. A command marked `after-human-confirmation` waits
   for the current Gate decision. Run a command whose `execution.target` is `agent-host`
   as an exact top-level host action with the required host access,
   not inside a restricted child sandbox. Follow the Route-selected procedure
   for its audit and approval contract; never invent a payload, destination, or
   substitute command.
   A Context command is complete only after its process returns an exit code and
   receipt. If the host reports that it is still running, keep polling that same
   invocation; never start a second Context write command in parallel.
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

Keep a conversation-local list of HTML review reports that the user actually
used to make a review decision. Preserve each exact report URL or local path
and its reviewed scope when the Route provides them. In the final completion
summary, include one compact `Review reports` section containing those exact
references. Do not scan workspace internals to reconstruct the list, persist a
second ledger, invent a public URL, or describe an inaccessible report or a
fully managed/force approval as user-reviewed.

When the user explicitly asks to publish a completed build, treat publication
as a downstream distribution step outside the Context Route. Use only an
explicitly installed distribution tool and its documented complete-output
upload command. If no such tool is available, stop after the local build and
explain that Context itself does not publish to a hosted service.

Do not infer repo sources, extraction scope, review decisions, or package output
choices from surrounding files. Do not call source-repo operations such as
clone, checkout, reset, fetch, install, build, or test without explicit user
approval.
