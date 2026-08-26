# Agent Guide

This guide is for Coding Agents operating a Context workspace.

## Start Here

1. If a public Agent entry is available, use the installed Context continuation command/skill from the project root; the exact slash command or skill name is host-specific.
2. If you are implementing that entry or operating without plugins, run
   `context status --format json`.
3. Treat `workflow.current` as the current-step authority. Read every
   `resources.required` item, execute only returned commands with their
   revision/authority flags unchanged, and rerun status after each action.
   A phase-local `next_action` may continue pagination or validation inside the
   current operation; it never replaces the workspace route.
4. Before editing `src/index.ts`, read [Project API](../reference/project-api.md).
5. Before declaring or repairing packages, read [Package Outputs](./package-outputs.md)
   and [Package Templates](../reference/package-templates.md).
6. Before asking a human gate question, read the dialogue resource selected in
   `workflow.current.resources.required`; use [Agent Dialogue](./agent-dialogue.md)
   only for stable cross-gate principles.

## Current-conversation fully managed mode

When the user explicitly requests fully managed operation in the current
conversation, use `context status --managed --format json` and keep `--managed`
only on commands that actually include it. Preserve every returned
revision/authority flag. Eligible classification, extraction
scope, structure confirmation, Review, and package-output gates may proceed
without another question. Review uses the CLI's atomic `context review
approve-all ... --managed` route; valid structure staging records
`confirmed_by: managed-session`.

The Provider may omit an ordinary Gate's HTML inspection Action and
user-dialogue resources only on its session-authority Route, then expose the
authority-selected revision-bound resolution Action directly. The ordinary
inspection and resolution capabilities remain available in ordinary mode.
Evidence reads needed to choose an extraction scope or classify a captured
document are not removed.

After the first managed status evaluation, use
`context run --managed --until blocked-or-complete --format json` when the
current work can advance through consecutive mechanical routes. The CLI
executes only a unique immediate non-read command, re-evaluates after each
receipt, and stops before Agent interpretation, configuration, missing
authority, diagnostics, or multiple commands. Continue from the returned
`workflow.current`.

This is execution authority, not project configuration. Do not add it to
`defineProject`, environment files, or committed workspace state, and do not
carry it into a new conversation. It never grants a new source boundary or
source-body read permission, authorizes clone/checkout/fetch/install/build/test
operations outside the Context workspace, or suppresses validation, close, or
verify failures. Without an explicit request, use ordinary status and all
existing human gates.

If the installed docs are unavailable, run `bun install` in the Context workspace.

## Dialogue Language

Use the user's current conversation language for explanations, questions,
confirmations, and final summaries. Treat CLI output, commands, flags, file
paths, ids, status values, JSONL payload keys, and `source_ref` tokens as
protocol text: copy those exactly and do not translate them.

At human gates, explain the product decision and impact before internal API
details. Do not start with `extractTs`, `include`, `exportedOnly`,
`reviewValidity`, placeholder commands, or raw TypeScript snippets unless the
user asks for implementation detail. The current gate's dialogue pattern is
selected by `workflow.current.resources`; [Agent Dialogue](./agent-dialogue.md)
explains stable cross-gate principles.

## Do Not Self-Discover The SDK

Do not write temporary scripts to inspect `node_modules/@c4a/context/dist/index.js`
or infer API shapes from bundled output. The public contract is documented in:

```text
node_modules/@c4a/context/docs/reference/project-api.md
node_modules/@c4a/context/docs/reference/package-templates.md
```

When configuring code extraction, use the Route-selected
`reference/code-extractors.md` manual. Run the Gate's read-only source
inspection first, use its manifest signals to select a matching extractor, and
read that package's public README before implementing an `extractCustom()`
adapter. Do not probe compiled package output or treat TypeScript as the default
for a non-TypeScript module.

## Workspace State Rules

- `src/index.ts` declares sources, phases, and packages.
- `sources/repo/index.yaml`, `sources/file/index.yaml`, and `sources/lark/index.yaml` declare sources.
- `.tmp/context-runtime/lifecycle/` is the ignored, CLI-managed draft candidate
  ledger and confirmed structure state for an open lifecycle round.
- `knowledge/` contains approved Markdown, the durable
  `knowledge/structure.yaml` projection, and (only when needed) the compact
  `knowledge/decisions.json` rejected candidate ID-to-fingerprint map.
- `knowledge/structure.yaml.source_inputs` contains only source, collection,
  and consumed snapshot hash for closed prose targets. It lets status detect a
  changed or unfinished target without retaining lifecycle snapshots.
- `dist/` contains generated package outputs.
- `.tmp/agent-payloads/` is the recommended location for transient inputs written
  by the Agent for CLI commands. It is not enforced, but avoids introducing
  top-level scratch directories; remove these files after the corresponding
  stage or apply succeeds unless the user explicitly wants to retain them.
- file and Lark documents from one date live as sibling files under `sources/file/<date>/` and `sources/lark/<date>/`; each date directory has one shared `manifest.json`.
- `.tmp/context-runtime/` contains ignored runtime cache, logs, review HTML, previews, and locks. Successful close removes completed lifecycle and review runtime state.

Do not create hidden workspace state directories.

## Workflow resources and entrypoints

Long procedures, semantic judgment rules, schemas, and current workspace views
are published as Context workflow resources. Status returns only the resources
selected for the current route. Read required resources before acting; use
recommended resources only when the current evidence or diagnostic needs them.
Do not preload every workflow resource or SDK manual.

Present only the current workflow surface:

| Task | Current route |
|---|---|
| Register a knowledge boundary | `context source add file/lark/repo ...`, followed by the matching project phase declaration. Source registration is a user-confirmed boundary decision. |
| Capture document sources | Run the declared `capture:file:<date>/<module>` or `capture:lark:<date>/<module>` phase only after read permission. Capture writes a sibling document file under the matching date directory, updates that directory's single `manifest.json`, and mechanically materializes supported Lark resources. Do not download or rewrite embedded resources outside the CLI. |
| Investigate captured material | Use `context status` and the returned `context run align:<type>:<source>:<collection> --view ...` commands. Evidence views drive reading; raw directory grep is not the workflow. |
| Confirm prose structure | `alignProse` validates and stages CLI-managed lifecycle structure. Validation does not equal user confirmation; only confirmed lifecycle state may enter prose compile. |
| Compile source-bound drafts | `compileProse` turns confirmed structure into source-bound draft pages. It does not approve knowledge. |
| Review and apply | Use `context review html` and `context review apply`. Approved prose pages are source-mirrored; rewrite/compression problems should return to structure/compile repair before apply. |
| Close, verify, build | Run `context close`, `context verify`, then `context build`. Close derives `knowledge/structure.yaml`, approved edge projection, and the final verify gate. |
| Code extraction | Use `context source inspect <source-name>` and the declared extract phase preview before code draft writes. |
| Source retraction | Follow the current status or lifecycle command if one exists. Do not delete `sources/`, `knowledge/`, `dist/`, or `.tmp` to simulate lifecycle actions. |

Judgment behavior is part of evidence views, source span resolvers, repair
hints, review/status diagnostics, OKF indexes, and package query discipline. Do
not describe unsupported commands or unsupported lifecycle state as alternate
routes.

## Source Safety

The CLI never silently clones, checks out, resets, fetches, installs, builds, or
runs scripts inside source repositories. If a repo operation is needed, ask the
user first.

`missing-source` is a human gate. In user-facing language, describe the next
action as adding a knowledge source, not as filling CLI placeholders. Treat this
as a source boundary decision. Document sources use today's local date as their
name. Repo sources use the date as a batch and require the confirmed module
identity. Do not invent semantic date suffixes. The concrete repo selector
appears in source refs, phase ids, and codeindex paths:

```text
knowledge/<collection>/<slug>.md
knowledge/<collection>/<containment>/<slug>.md  # intentional hierarchy only
repo:<date>/<module>#symbol:...
file:<source-name>/<document>#span:...
lark:<source-name>/<document>#span:...
capture:file:<source-name>
align:lark:<source-name>:architecture
dist/<source-name>-kb/
```

Every prose View requires a stable filename `slug`. The CLI derives its path
from collection, slug, and optional `containment`; omit `path` from the input.
Supply `containment` only for an intentional parent/child hierarchy;
independent collection entries stay directly under the collection.
Codegraph paths use the registered date/module grouping before the symbol slug.

Ask what the user wants the source to cover: a single local Markdown/MDX document,
a local Markdown/MDX directory, an article/documentation repository as a file
source, a Lark/Feishu document URL or token, a local code repo/package, or a
remote Git repo/package. Repo sources use today's date as one batch and a
confirmed `--module` identity; do not create date suffixes for separate
packages. The CLI rejects non-date or impossible repo batch names. Use
`context source ensure <date>` / `context source inspect <date>` to operate on
all registered modules in one batch, or `<date>/<module>` for one module.
If the user supplies several repo/file/Lark sources in one request, create one
`context source add batch <date> --input <payload> --format json` payload and
register them under a single project write lock. Never parallelize mutating
`source add` commands; on a lock-held error, wait and retry.

Do not select sources from repository layout or Git metadata. After the user
has named an exact local module or path, however, resolving one unique matching
directory and reading its Git root, `origin`, and current commit are mechanical
identity checks. Pass the resolved local path relative to the Context project
root; when the workspace was initialized in a child `context/` directory,
recompute sibling paths from that new root. In ordinary and fully managed modes,
do not request a remote URL again when that confirmed local checkout provides
it.

Current execution supports repo sources, local Markdown/MDX file sources, and Lark /
Feishu document sources. Local
repo/package sources are registered with `context source add repo [YYYYMMDD] --module <module> --local <path>`;
the materialized `sources/repo/<date>/<module>` entry is an ignored
relative symlink to the selected checkout or subdirectory view. If the source
and Context workspace share a Git root, absolute input is normalized to a
workspace-relative repo root plus `subpath`; do not rewrite it back to an
absolute machine path. Local Markdown/MDX sources
are registered with `context source add file [YYYYMMDD] --module <module> --local <path>` plus any
needed `--include` patterns, captured with `captureFile`, then planned through
`alignProse` and compiled with
`compileProse`. A one-file-to-one-page outcome is a degenerate structure plan,
not a separate content path. Remote Git operations require explicit user approval before any
clone/checkout; clone into an ignored local path, checkout the requested commit,
then register that local checkout. Do not commit cloned source content. Lark /
Feishu sources are registered as document modules under a shared date batch,
captured through the Lark capture phase, and written as committed snapshots
as a sibling file under `sources/lark/<date>/`, tracked by the date-level `manifest.json`;
do not fetch or import Lark content with ad hoc scripts.
If the user requests multiple documents together, register and declare all of
them before capture. The user's explicit batch request supplies one read scope,
but it does not imply a mainline collection unless the user explicitly chose
one. Follow `workflow.current.commands`: run `immediate` items directly and run
`after-human-confirmation` items only after the current conversation contains
that confirmation. Preserve the returned workflow revision and authority flags
exactly. Do not ask for another date name or repeat the collection gate per
document.

## Current-step protocol

Treat `context status --format json` `workflow.current` as the complete
protocol for the current step:

- `availability` distinguishes an immediately executable route from a human
  decision or a blocked route;
- `gate` identifies the decision, its authority, and whether a managed session
  may resolve it;
- `configuration` identifies the exact project file and declaration action when
  no CLI command is valid yet;
- `commands[].availability` says whether each command runs immediately or only
  after user confirmation;
- `resources.required` is the complete mandatory context for this route;
- `resources.recommended` is optional follow-up context; and
- `after_action.evaluate` requires status to be evaluated again after the
  action.

Read a resource `path` directly. If a resource provides `command`, execute that
revision-bound Context command and read the returned file. Long procedures and
semantic rules live in these resources; they are loaded progressively, not
discarded or shortened into the status response.

Status also returns `declarationGraph` and `configurationGaps`. These expose
capture, align, compile, and Review coverage for each canonical document source
and declared align collection. Missing declarations are early warnings while
structure is still being planned; after confirmation, every collection planned
by the structure must have an exact compile route for the same source. Do not
run a compile command from another collection as a fallback. A
`reviewValidity({ scope: "all" })` declaration covers every collection.

When `workflow.current.reason_code` is
`route.document.classification-required`, execute its read-only
`inspection_action` commands before adding align/compile declarations. Inspect
every unclassified target, explain the evidence behind the proposed mainline
collection, and wait for user confirmation. Filenames, URLs, source titles,
and collection names are hints, not sufficient classification evidence.

Also inspect `pendingStructureTargets`. A non-empty list means captured document
work remains outside the active structure snapshots, even if the current package
is already built. Follow `needs-prose-configuration` first when declarations are
missing, then run the exact returned align command. Continue in the same
workspace; do not replace a valid earlier structure round or create a second
workspace merely to add the next document. Missing declarations are selected
by `route.prose.configuration-required`; do not branch on an old top-level
`needs-prose-configuration` state.

Use `structureBatch` for the complete multi-source slot overview. Evidence View
commands are workspace-read-only and parallel-safe; structure stage/confirm,
compile stage, Review apply, and close mutate workspace state and must run
serially.

The confirmation and Review scopes are different: confirm each canonical source
plus collection structure slot independently, but do not open Review while
another declared slot remains pending in the same round. Compile every View from
all slots first, open one collection-level Review, and let deterministic close
merge the active slots into `knowledge/structure.yaml`.

Do not infer permission from the presence of a command. When
`workflow.current.commands` is empty, do not derive a lifecycle command from
prose; complete the returned `configuration` action or resolve the returned
gate, then rerun status.

Extraction scope is also a human gate. If no extract phase is declared, explain
what code area and symbol policy will become draft knowledge, then ask which
registered source and file/symbol range to ingest. Do not inspect the source
repository to choose packages or globs on the user's behalf. The
`route.extract.configuration-required` Route carries
`workflow.current.configuration` until that confirmed scope is declared; only
a declared phase can select `route.extract.pending-target` and return an
executable preview or extraction command.

For a fresh mixed-source workspace, capture every confirmed file/Lark source
first. If repo code is still unprocessed and document structure has not started,
`context status` prioritizes `route.extract.pending-target` over document
investigation. Complete code extraction and its batch Review before starting
prose align. Once a document structure draft exists, keep that current human
gate and do not switch workflows mid-review.

For monorepos, the date is one registration batch and every selected package is
a module under it. Stable codeindex paths omit that batch date and therefore
look like `knowledge/codeindex/module-a/...` and
`knowledge/codeindex/module-b/...`. Date/module remains in phase ids and
repo source refs. Use the whole repo/subspace
only for inspection when it contains multiple modules. If the user chooses
`packages/button`, register it with `--module button` under the same date and
write `extractTs({ source: source("20260712", "button"), ... })`. Do not use
`include: ["packages/button/src/**"]` to choose a package from a larger source;
`include` only filters files inside the selected source. Repo module names are
project-wide codeindex identities; refresh an existing module through its
original date/module selector instead of reusing its name under a later date.

For a non-standard package, configure source-relative `entries` on `extractTs`;
every entry must match `include`. If the user wants all declarations in the
selected files instead of public API reachability, use `mode: "scan"`, which
needs no entries and defaults to including internal symbols. Never add an entry
file or package manifest field to the source repository solely to make Context
run.

Follow the source inspection pattern when scope is unclear: run
`context source inspect <date>/<module> --format json`, show the candidate package
paths from that CLI output, wait for the user to choose the package path(s), then
declare sources/phases. If the extraction preview reports modules outside the
confirmed source boundary, stop before review and repair the source declaration.

Before running extraction, prefer:

```bash
context source inspect <date>/<module> --format json
context run <extract-phase-id> --dry-run --format json
```

After the preview, run codeindex extraction normally unless the user explicitly
asked for CI/CD automation. The first normal run requires Review for all code
candidates. Subsequent normal runs require Review only for added, changed, or
removed symbols; unchanged approved symbols stay approved. After each result,
run `context status --format json`. `continue-codeindex-batch` only requests
workspace re-evaluation. Open Review only when
`workflow.current.gate.id=knowledge-review`; otherwise execute the current
route.

For a non-interactive pipeline, use `context run <extract-phase-id>
--auto-promote --format json`. This flag applies only to codeindex, applies its
deterministic deltas, refreshes deterministic close when needed, runs verify,
and fails the command if close or verify fails. Read `autoPromotion.close` and
`autoPromotion.verify` before continuing. Package build remains explicit: when
the pipeline publishes packages, run `context build` after successful auto
promotion. Never use auto promotion for semantic knowledge collections.

Use the preview `mode`, optional `entries`, `preview.sources[].modules[]`,
`entryFiles`, exported/internal symbol counts, `candidateKinds`,
`candidateEstimate`, and `agent_hints`
fields as the authoritative scope check. To the user, call it a preview without
writing candidates; avoid the internal CLI term. Also show `knowledgeTree` and
`knowledgePathExamples` before first extraction.

These are structural extractor facts. Do not turn kind counts or file paths
into a product-specific recommendation unless the user or Agent supplies that
judgment.

Treat `NO_ENTRY_DETECTED` as a configuration failure: choose explicit
`entries`, or use `mode: "scan"` when the intended scope is all matched files;
never report an empty extraction as success. Report discovered, AST-analyzed,
skipped, symbol, and relation counts separately. The extractor follows
tsconfig/jsconfig `baseUrl` and `paths`, so do not ask users to rewrite `@/`
imports solely for Context. Explain the concrete output shape:

```text
knowledge/codeindex/<module>/symbol/<slug>.md
```

If the module or resulting path shape looks wrong, stop and repair the
module registration before running extraction. An extra repeated package
segment below the module may indicate an over-broad source boundary. Do not write ad hoc scripts to
count packages, parse `package.json`, or sample the lifecycle candidate ledger.

## Review Rules

- Use `context review html <collection> --open --format json` for visual review.
  Check `opened`: say the browser opened only when it is `true`; otherwise
  report `open_error` and provide the emitted `file_url` plus `absolute_path`.
- Use `context review list <collection>` only for a textual overview.
- Ask the user to paste the copied review decision Payload into chat. Uniform
  decisions use one JSON line; exceptions add JSONL lines. The agent writes
  that pasted payload to a temporary scratch file and runs `context review apply
  <payload-file>` only after the user has reviewed and provided the payload.
- Do not synthesize review payloads from HTML, JSON, runtime snapshots, or
  candidate ids.
- Do not default candidates to approved/rejected on behalf of the user.
- If the user explicitly authorizes a quick or automated decision, use
  `context review approve <candidate-id> --collection <collection>` /
  `context review reject <candidate-id> --collection <collection>` or `--all`.
  These commands still enforce the scoped candidate-id gate.
- Do not edit approved Markdown by hand as part of review apply.

## Prose Align And Compile Rules

After document capture, do not ask the user to choose an SDK path. Explain the
product sequence:

1. investigate material through Context evidence views;
2. propose a structure draft with nodes, section plans, supported edges, and
   unresolved items;
3. resolve only the non-mechanical blockers until validation state is `ready`,
   stage the structure, open its HTML report, then follow the current Route's
   structure-confirmation gate;
4. compile source-bound draft pages from confirmed structure;
5. send compiled drafts through human review, then close and build.

One file per page is still possible, but it is represented as a simple
structure draft. It does not bypass structure confirmation or compile.

Material investigation:

```bash
context run align:<type>:<source>:<collection> --view read-plan --format json
context run align:<type>:<source>:<collection> --view source-index --compact --format json
context run align:<type>:<source>:<collection> --view span-detail --span <source-ref> --format json
context run align:<type>:<source>:<collection> --view span-text --span <source-ref> --format json
context run align:<type>:<source>:<collection> --view existing-knowledge --query <title-or-stable-ref> --format json
context run align:<type>:<source>:<collection> --view schema --format json
context run align:<type>:<source>:<collection> --validate --input <structure.yaml> --format json
context run align:<type>:<source>:<collection> --view structure-summary --input <structure.yaml> --format json
context run align:<type>:<source>:<collection> --stage --input <structure.yaml> --format json
```

Read source material only through these evidence views. `source-index` gives a
compact refs-first map when run with `--compact`; use `span-detail` /
`span-text` only for exact evidence. Before introducing a new Node identity,
use the targeted `existing-knowledge` View returned by the read plan to inspect
approved stable refs; do not inspect `knowledge/**` directly. The CLI applies
deterministic boundary repairs internally and returns only blockers that need
Agent judgment. For oversized Views, use the returned structural diagnostics
while classifying
child Nodes from evidence. Stage only after validation state is `ready`; stage
opens the final `structure-summary` report for the current Route's confirmation
gate. Ask a separate structure-design question only when evidence supports
multiple incompatible semantic choices. Do not inspect `sources/` or `.tmp`
directly.

Compile:

```bash
context run compile:<type>:<source>:<collection> --view read-plan --format json
context run compile:<type>:<source>:<collection> --validate --format json
context run compile:<type>:<source>:<collection> --stage --format json
context run compile:<type>:<source>:<collection> --view diagnostics --format json
```

Compile derives every candidate mechanically from the confirmed section ids,
kinds, ownership, and source spans. One stage command validates the complete
source/collection slot before atomically writing its candidates. The Agent does
not author compile actions or rewrite reader-visible body. Re-evaluate status
after the batch, finish any other structure slots, then open one
collection-level Review, apply one Payload, and run close once.

Relationships and cross references remain structure typed edges; compile does
not infer them or inject relation markers into verbatim body.

## Package Rules

If `workflow.current.reason_code` is `route.package.output-required`, treat it
as a human gate.
First read [Package Outputs](./package-outputs.md). Then explain the package
decision using concrete output trees, not unexplained labels.

Recommended first option:

```text
dist/<name>-kb/
├── AGENTS.md
├── skills/knowledge-query/SKILL.md
└── wikis/
    ├── index.md
    ├── <group-page>.md
    └── <large-group>/index.md
```

This is an agent knowledge-base package. It is the recommended first output for
agent consumption; the internal `skills/` folder follows agent installation
conventions.
The package name already identifies the surrounding `dist/` directory. Its OKF
roots stay flat (`wikis/`, `guides/`, `rules/`, and `feats/`), so do not ask for
a second distribution namespace. Ask separately whether the author wants a
short Skill prefix; if so, maintain the complete final Skill directory name in
the template.
The default `knowledge-query` skill teaches agents to query copied OKF root
directories structure-first, starting with `wikis/`, cite
page/section evidence, use structure/build metadata when present, and report
gaps instead of inventing unsupported answers. Tell the user that
`src/package-templates/kb/` is editable before build, so they can customize the
query skill or add project-specific skills when needed.

Selected OKF root subtrees such as `wikis/`, `guides/`, `rules/`, and
`feats/` follow the C4A OKF Profile. The package root contains agent
installation files; the OKF-compatible interchange surface is the selected OKF
root directories. Tell the user they can customize
`src/package-templates/kb/wikis/index.md` before build to describe package
scope and query guidance. The default root index should list only next-level
entries. By default, `context build` links small directory contents directly
and generates a child index only when that directory contains more than 50
selected knowledge pages.

Alternative:

```text
dist/<name>-llms/
└── llms.txt
```

This is an LLM text bundle output for one model/RAG import file.

The user may also skip package output for now and keep only `knowledge/`.

Do not offer `both` as a shortcut. If the user wants multiple outputs, declare
one package first, build and inspect it, then ask before adding another.

Every package needs a template path. Treat `src/package-templates/kb` and
`src/package-templates/llms` as editable starting points, not final deliverables.
The agent knowledge-base package template must contain at least one `SKILL.md` and
`wikis/index.md`; otherwise it is a hollow package and should not be reported
as usable. Template paths also must not collide with copied knowledge paths.
When a collision is reported, rename the template file or exclude the knowledge
path before build.

Do not present a clean `context build`, clean `context verify`, or file count as
proof that the output is useful. Inspect the generated package shape against the
user's chosen output contract.
