# Knowledge Project Walkthrough

This guide shows the common Context workspace shape. The same workspace can
ingest source documents, code repositories, or both. Start with the user's
source boundary, then declare the matching phases in `src/index.ts`.

For normal use, start from the installed Context Agent entry and describe the
knowledge goal. The entry resolves whether it should initialize a workspace,
enter an existing workspace, or continue the current production round:

```text
/c4a:context Build a traceable knowledge package from this repository and the
documents I provide. Explain each source and structure decision before asking
for confirmation.
```

The remainder of this guide explains the project model behind that
conversation. Command examples are maintainer orientation; an Agent should
prefer the exact command and resources returned by `workflow.current`.

## 1. Establish the workspace

When initialization is required, the Agent runs the exact action returned by
`context entry`. A manual equivalent for automation or source development is:

```bash
context init context
cd context
bun install
context status --format json
```

Use `--language zh-CN` (or `--language en`) during initialization when the
generated README, AGENTS contract, and package starter templates should use a
specific language. Context stores this choice in `package.json`; it does not
guess from the shell locale or Agent conversation.

Use `--dev` only when testing a locally linked CLI or a prepared package before
the matching SDK version is published. It writes a `file:` dependency to the SDK
resolved beside the active CLI. Registry installs should use the default command
above so the workspace receives the matching versioned SDK dependency.

Without `project-dir`, init uses the dedicated `context/` directory. Initializing
inside a non-empty directory that is not already a Context workspace is blocked
before any files are written; use the returned `--allow-nonempty` command only
after confirming that the existing files should share the workspace root.

After initialization, return to the single installed Context Agent entry from
the project root. It consumes `workflow.current`, loads only the selected
resources, and calls lower-level CLI primitives as needed. Do not introduce a
separate continuation entry.

## 2. Choose And Register A Source Boundary

First decide what one source should mean for this workspace. Document sources
use one date name (`YYYYMMDD`). Repo sources use two levels: the date is a
capture batch and `--module` identifies the concrete package or code boundary.
Several repo modules can therefore be registered under the same date. Use the
confirmed package/module identity for `--module`; do not invent semantic source
suffixes from prose or content. ViewRef/NodeRef are identity fields, not path
strings:

```text
knowledge/<collection>/<slug>.md
knowledge/<collection>/<containment>/<slug>.md  # intentional hierarchy only
repo:<date>/<module>#symbol:...
file:<source-name>/<document>#span:...
lark:<source-name>/<document>#span:...
dist/<source-name>-kb/...
```

For a Markdown or MDX document corpus, register a file source and keep the
include list inside the user-approved boundary. Default file capture handles
Markdown. For MDX documentation sites that use `_meta.json` route metadata,
declare `captureFile({ source: docs, processor: mdxJsonDocs() })` in
`src/index.ts`; `_meta.json` files are route metadata, and the CLI generates
mechanical evidence pages for route facts and static MDX component text:
`__context_route_metadata.md` and `__context_mdx_component_text.md`. If the CLI
reports that a file source looks like a documentation site but lacks the
processor, confirm the source boundary and add the processor before capture.
If the selected page is only a runtime shell, capture the rendered-site source
or project-specific data source explicitly; do not ask the agent to invent
missing body text. The concrete command shape is available from
`context source add file --help`; after registration, declare `captureFile`
and `reviewValidity`, then let the Context Indexer lifecycle create the
confirmed requirements and exact Provider registry in `src/indexers.yaml`.

For a Lark / Feishu document, register a Lark source with exactly one identity
form, then declare `captureLark` and `reviewValidity`. Do not add
`alignProse`/`compileProse` to a new workspace; those factories remain only for
explicit migration and repair of older declarations.

File and Lark sources use the same date-batch shape as repo sources. Multiple
documents belong under one date instead of receiving `-2` / `-A` suffixes:

```bash
context source add lark 20260712 --module user-manual --url <wiki-url>
context source add lark 20260712 --module migration-guide --url <wiki-url>
context source add file 20260712 --module local-manual --local ../manual
```

When these sources are supplied together, they can be registered in one locked
batch. Save the following as YAML/JSON or pipe it through stdin:

```yaml
sources:
  - type: repo
    module: component-lib
    local: ../component-lib
  - type: lark
    url: <wiki-url>
  - type: file
    local: ../manual
```

```bash
context source add batch 20260712 --input sources.yaml --format json
```

Do not run multiple `context source add` commands concurrently. All source
registry writes use one project lock and atomic replacement; if the lock is
held, wait for the active command and retry.

The command returns each concrete derived document module; use that value in a
declaration such as `source("20260712", "wiki-<digest>", { type: "lark" })`.
Snapshots are written as sibling files under `sources/lark|file/20260712/` with
one date-level `manifest.json`; phase ids and manifest entries use the logical
`YYYYMMDD/module` identity without creating a module subdirectory.

If several documents were requested together, register and declare every
module first. An explicit request to capture/read those exact paths or URLs is
the read confirmation for that requested batch; do not ask again after
registration. Merely mentioning a possible source is not permission.
`context status --format json` returns all remaining capture phases in
`workflow.current.commands`. Every item requiring the confirmed read scope is
marked `after-human-confirmation`, so one explicit confirmation can authorize
the complete requested batch without pausing for another date name or
collection choice between modules. If any module lacks a declaration,
`workflow.current.configuration` identifies the precise project change instead
of returning an unexecutable command. Read every
`workflow.current.resources.required` item before acting; long procedures and
semantic rules remain available as files and are loaded only for the route that
needs them.

After capture, status selects `route.indexer.lifecycle-required`. Follow its
`run-indexer-lifecycle` resource and the exact `context indexer ...` outcomes:
confirm the complete requirement set, discover and resolve an exact Markdown
Provider, execute its evidence-bound worksets, reconcile/layout/audit the
Result, and compile the current Candidate batch. Batch read permission does
not choose requirements, a Provider, or a collection.

When the workspace also contains repo sources, Context prioritizes untouched
code and document owner cells through that same Indexer Route. It does not
switch to a second extraction or prose lifecycle and does not interrupt an
accepted workset that is already durably recorded.

For a single component package, use the package directory as the repo source
boundary:

```bash
context source add repo 20260712 \
  --module component-lib \
  --local ../component-lib \
  --remote <git-remote-url> \
  --ref <commit-sha-or-prefix>
context source ensure 20260712
context source inspect 20260712/component-lib
```

If `component-lib` and the Context workspace are inside the same Git checkout,
the CLI stores the repo root relative to the workspace even when `--local` was
absolute. The module symlink target is relative as well, so the checkout can be
moved without rewriting source metadata. External checkouts may keep an
absolute repo root.

Repo batches must be valid calendar dates in `YYYYMMDD` form; suffixes such as
`20260712-A` are rejected. `source ensure <date>` and `source inspect <date>`
operate on every repo module registered under that date. A full
`<date>/<module>` selector still targets one module.

For a monorepo or subspace, choose the boundary deliberately:

- Register each confirmed package/subdirectory with its own `--module` under
  the same date batch.
- A parent monorepo registration is an inspection boundary only when it resolves
  to multiple packages; extraction remains bound to concrete registered modules.

The long-term multi-module knowledge shape is stable across capture dates:

```text
knowledge/codeindex/module-a/...
knowledge/codeindex/module-b/...
```

The CLI records each module's git root and subpath, then materializes
`sources/repo/<date>/<module>` to the scoped view. Do not rely on
`extractTs.include` to select a package; `include` is only a file filter inside
one selected module.

If the user first registers a monorepo root, run `context source inspect <date>/<module>`
before extraction. Show the listed module paths to the user as a tree and
register each chosen package path under the same date. The
inspect output includes package names, manifest paths, versions when available,
and suggested `context source add` commands.

Remote Git sources need the same boundary decision. Ask for the remote URL, the
pinned commit/ref, and whether the user approves cloning. The CLI does not
clone, checkout, reset, or fetch silently. If registered source material is
missing, the current Route exposes a repository recovery plan. The user chooses
an existing checkout, a bounded local scan, or an explicit shallow/partial clone
of the registered pinned commit. Context validates the remote, commit, and
subpaths, restores local aliases, and materializes module links. Advancing to a
new upstream commit remains a separate source-update decision.

For a long-lived production workspace with project-specific source ownership or
impact rules, copy the optional maintenance Skill template from
`templates/project-skills/maintain-project-knowledge/SKILL.md` into the
project's `.agents/skills/`, rename it for the project, and edit its project
facts. Keep Context lifecycle commands in the installed Context Skill and
current Route rather than duplicating them in the project Skill.

## 3. Declare The Flow

### Document Source Flow

For source documents, keep the project declaration small. `src/index.ts`
declares the trusted source/capture/review/package surface; the confirmed
requirements and exact Provider selection live separately in
`src/indexers.yaml`:

```ts
import {
  captureFile,
  defineProject,
  reviewValidity,
  source,
} from "@c4a/context";

const docs = source("20260704", "product-docs", { type: "file" });

export default defineProject({
  sources: [docs],
  phases: [
    captureFile({ source: docs }),
    reviewValidity({ scope: "all" }),
  ],
  packages: [],
});
```

Then return to the installed Context Agent entry. For maintainer inspection,
`context status --format json` exposes the same current Route. The normal
sequence is:

1. capture the source into committed snapshots;
2. confirm requirements and resolve exact Code/Markdown Providers through the
   sole Indexer Route;
3. execute and reconcile evidence-bound worksets, then derive layout and audit
   the Result;
4. compile and review/apply the complete Indexer Candidate batch once;
5. run close once, then verify and build when packages are declared.

See [Indexer Provider selection and customization](./guides/indexer-provider-and-customization.md)
for the registry and Provider flow. Existing workspaces that still declare
`alignProse`/`compileProse` may use their explicit diagnostic commands during
migration, but Context does not select them as the default workflow.

Do not read `sources/` or raw Markdown directly after entering the Context
workflow; use the evidence views and `source_ref` values returned by the CLI.

### Code Source Flow

Edit `src/index.ts`:

```ts
import { defineProject, extractTs, reviewValidity, source } from "@c4a/context";

const componentLib = source("20260712", "component-lib");

export default defineProject({
  sources: [componentLib],
  phases: [
    extractTs({ source: componentLib, collection: "codeindex" }),
    reviewValidity({ collection: "codeindex" }),
  ],
  packages: [],
});
```

Inspect and run:

```bash
context run --list
context run extract:20260712/component-lib:codeindex --dry-run
context run extract:20260712/component-lib:codeindex
```

When operating through an Agent, use `--dry-run --format json` as the CLI
implementation for a no-write preview. For extract phases it returns a
`preview` block with resolved sources, modules, file counts, symbol counts,
resolved entry files, exported/internal counts, symbol-kind counts, candidate
estimates, `knowledgeTree`, `knowledgePathExamples`, and module-level hints.
Treat that preview as a structural scope check before producing draft
candidates; the CLI does not decide which symbols are important to a business
or audience.

The codeindex path keeps the stable module identity. The date stays in the repo
source ref and phase id, not in the knowledge path:

```text
knowledge/codeindex/<module>/symbol/<slug>.md
```

Show the tree/path preview to the user before first extraction and describe it
as a preview without writing candidates. If the module or path shape is not
what the user expects, fix the module registration before extraction. An
extra repeated package segment below the module may indicate an over-broad
boundary.

When one confirmed round contains several repo modules, preview and run their
extract phases sequentially but defer the human gate until every phase finishes.
The final Codegraph Review contains the combined draft set; do not review one
module at a time.

## 4. Review

```bash
context review html architecture --open
```

Use the generated HTML page to approve or reject candidates. If the browser does
not open automatically, use the emitted `file://` URL. When
finished, open `Payload` and copy the review decision Payload into the agent chat.
Uniform decisions use one JSON line; exceptions add JSONL lines. The agent
writes that pasted payload to the recommended workspace scratch area,
`.tmp/agent-payloads/`, and runs:

```bash
context review apply <payload-file>
```

Do not hand-write approved Markdown. `context review apply` owns materialization
from the CLI-managed lifecycle candidate ledger into `knowledge/`. The runtime
ledger is ignored and is removed after a successful close; durable rejected
candidate fingerprints, when any, are kept in `knowledge/decisions.json`.
The location is a recommendation rather than a CLI restriction. Do not create a
top-level scratch directory or edit workspace config merely to retain a review
payload.

## 5. Build Packages

This is a product decision point. Before editing `packages`, read
[Package Outputs](./guides/package-outputs.md) and explain the output tree to the
user.

Recommended first output:

```text
dist/component-lib-kb/
├── AGENTS.md
├── skills/
│   └── knowledge-query/
│       └── SKILL.md
└── wikis/
    ├── index.md
    ├── <group>/
    │   ├── index.md
    │   └── ...
    └── ...
```

Choose an agent knowledge-base package when agents should consume the reviewed
knowledge as a reusable package. After the user chooses this output shape,
declare it with `kbPackage()`.

The package name already identifies the surrounding `dist/` directory. The OKF
roots inside it stay flat (`wikis/`, `guides/`, `rules/`, and `feats/`), so do
not ask for a second distribution namespace. Ask separately whether the author
wants a short Skill prefix, then maintain the complete final Skill directory
name in the template.

The default `knowledge-query` skill teaches agents how to query copied OKF root
directories structure-first, starting with `wikis/`, cite
page/section evidence, inspect structure/build metadata when present, and report
gaps instead of inventing unsupported answers. Before building, tell the user
that `src/package-templates/kb/` is editable: they can change the default skill
wording or add product-specific skills when the package needs behavior beyond
knowledge lookup.

Selected OKF root subtrees such as `wikis/`, `guides/`, `rules/`, and
`feats/` follow the C4A OKF Profile. The package root contains agent files; the
OKF-compatible interchange surface is the selected OKF root directories. Edit
`src/package-templates/kb/wikis/index.md` before build to describe package
scope, intended users, and query guidance; other selected OKF root indexes are
generated unless the template supplies them.

Alternative:

```text
dist/component-lib-llms/
└── llms.txt
```

Choose an LLM text bundle when the user wants one text bundle for model/RAG
import. After the user chooses this output shape, declare it with
`llmsPackage()`.
The user may also skip package output for now and keep only `knowledge/`.

Do not offer `both` as a shortcut. If multiple outputs are needed, add one
package first, inspect it, then add another after confirmation.

Copy or create templates under `src/package-templates/`, inspect that they match
the intended output shape, then declare packages. A `kbPackage()` template
must contain at least one `SKILL.md`; the default template also includes
`wikis/index.md`. The default template is a starting point, not proof that the
final package is useful.

```ts
import {
  defineProject,
  extractTs,
  reviewValidity,
  kbPackage,
  source,
} from "@c4a/context";

const componentLib = source("20260712", "component-lib");

export default defineProject({
  sources: [componentLib],
  phases: [
    extractTs({ source: componentLib, collection: "codeindex" }),
    reviewValidity({ collection: "codeindex" }),
  ],
  packages: [
    kbPackage({
      name: "component-lib-kb",
      template: {
        path: "src/package-templates/kb",
        vars: { displayName: "Component Library KB" },
      },
      select: { include: ["codeindex/component-lib/**"] },
    }),
  ],
});
```

If the user chooses an LLM text bundle instead, declare `llmsPackage()` in place
of the agent knowledge-base package:

```ts
llmsPackage({
  name: "component-lib-llms",
  template: "src/package-templates/llms",
  select: { include: ["codeindex/component-lib/**"] },
});
```

Build and verify:

```bash
context build
context verify
context status
```

Outputs are written under `dist/<package-name>/`.

After build, inspect `dist/<package-name>/` before calling the package usable.
A clean command exit only means the workspace protocol is valid.
