# Context Architecture Overview

Engineering guide for the project-local knowledge workspace tooling in this
directory. For user-facing setup see [README.md](README.md); for package usage
see each `packages/*/README.md`; for development rules see [CLAUDE.md](CLAUDE.md).

## System Topology

```
┌──────────────────────────────────────────────────────────────────┐
│  User / AI Agent                                                 │
│  ┌──────────────┐   ┌────────────────────┐                      │
│  │ Agent plugin │   │ context CLI         │                      │
│  │ thin entries │──►│ init/status/run/... │                      │
│  └──────────────┘   └──────────┬─────────┘                      │
└────────────────────────────────┼─────────────────────────────────┘
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  Bundled Context workflow Provider                               │
│  Agent Graph evaluates normalized facts → route + resources      │
│  CLI adapter binds the selected action to a revisioned command   │
└────────────────────────────────┬─────────────────────────────────┘
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  Project-local workspace                                         │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  │ src/index  │ │ sources/      │ │ .tmp/        │               │
│  │ SDK config │ │ snapshots     │ │ lifecycle    │               │
│  └─────┬──────┘ └──────┬───────┘ └──────┬───────┘               │
│        │               │                │                       │
│        ▼               ▼                ▼                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ .tmp/context-runtime/lifecycle/                             │  │
│  │ staged structures and active candidate ledger              │  │
│  └────────────────────────────┬───────────────────────────────┘  │
│                               ▼                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ knowledge/                                                  │  │
│  │ approved pages + structure.yaml + compact decisions.json   │  │
│  └────────────────────────────┬───────────────────────────────┘  │
│                               ▼                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ dist/                                                       │  │
│  │ package output: wikis / guides / rules / feats + inventory  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

The architecture is intentionally local-first. There is no server, daemon,
database, hosted API, or web frontend in this workspace. The CLI reads declared
sources, writes workspace files, validates invariants, and produces portable
knowledge packages.

## Package Dependency Graph

```
packages/context        SDK: project definition, sources, phases, package config
       ▲
       │
packages/context-cli    CLI: workspace lifecycle, validation, review, build
       ▲       ▲
       │       │
packages/extract-ts ────┘       TypeScript / TSX code extraction plugin
       ▲
       │
packages/extract        extraction protocol, scanning, parser helpers, snapshots

@c4a/agent-graph       model-free workflow contract evaluation and resources
packages/core           shared schemas/utilities used by dev and extraction code
packages/tui            Ink terminal components
packages/dev-cli ──────► build/link/publish/development menu
```

Modification blast radius:

- `packages/context` affects workspace declarations and phase/resource plans.
- `packages/context-cli` affects user commands, agent workflows, workspace file
  formats, review/apply behavior, and package output.
- `@c4a/agent-graph` is an external runtime dependency used only by the bundled
  Context workflow adapter; Context owns its Provider and host bindings.
- `packages/extract` and `packages/extract-ts` affect codegraph extraction.
- `packages/tui` and `packages/dev-cli` only affect development tooling.

## Runtime & Build

| Aspect | Choice | Notes |
|---|---|---|
| Runtime | Node-compatible JavaScript | Runtime code uses Node.js APIs; Bun is used for development/build/test |
| Module system | ESM | All packages use `"type": "module"` |
| Build | `packages/build.ts` | Shared Bun build wrapper for bundled package output |
| CLI binary | `packages/context-cli/dist/cli.js` | Built with a Node shebang for installed usage |
| Tests | `bun:test` | Unit tests in `src/__tests__`, E2E in `context-cli/src/__e2e__` |
| Plugins | `context-cli/plugin` → `dist/plugins` | Thin generated entries for Claude/Codex/Cursor and standalone Skill hosts |
| Workflow | `context-cli/context-workflow` → `dist/providers/context` | Immutable Agent Graph Provider, resources, schemas, and graph tests |

Root scripts:

```bash
bun install
bun run build
bun run typecheck
bun run test
bun run lint
bun run verify
```

Link the CLI for installed-mode testing:

```bash
bun run --cwd packages/dev-cli src/index.tsx link
```

## Workspace Lifecycle

```
init
  └── creates project-local workspace, src/index.ts, AGENTS.md, templates

source add / capture
  └── declares local/Lark/repo sources and snapshots source evidence

align
  └── reads evidence views and writes context.structure.v1 drafts

compile
  └── turns confirmed structure sections into source-mirrored draft pages

review
  └── approval authority boundary; apply writes approved knowledge pages

close
  └── derives knowledge/structure.yaml from approved pages and confirmed edges

build
  └── maps approved knowledge into package-facing OKF roots and inventory

verify
  └── validates source refs, frontmatter, approved structure, and package state
```

The main state directories are:

| Directory | Owner | Purpose |
|---|---|---|
| `src/index.ts` | SDK user/project | Declares sources, phases, and packages |
| `sources/` | CLI | Source registries and captured snapshots |
| `.tmp/context-runtime/lifecycle/` | CLI + review gate | Disposable structure drafts and active candidate records; removed after successful close |
| `knowledge/` | CLI after approval/close | Approved pages, `structure.yaml`, and compact rejected candidate fingerprints in `decisions.json` |
| `dist/` | CLI build | Generated package output |
| `.tmp/` | CLI/runtime | Run logs, review HTML, reports, transient payloads |

## SDK Model

The SDK package is the project declaration surface. A workspace `src/index.ts`
uses `defineProject()` to declare:

- `sources`: stable source handles such as repo, file, or Lark sources.
- `phases`: capture, extraction, prose align, prose compile, and review checks.
- `packages`: portable outputs such as knowledge-base packages and LLM bundles.

Key SDK modules:

| Module | Role |
|---|---|
| `contracts.ts` | Collection/root enums and runtime assertions |
| `sources.ts` | Source references and registry loading |
| `phases.ts` | Phase constructors and resource plans |
| `documentEvidence.ts` | Document section metadata and compile schema constants |
| `index.ts` | Public exports and package definition helpers |

Important identity concepts:

- `NodeRef` identifies the underlying concept, for example `entity/example`.
- `ViewRef` identifies a collection-specific view, for example
  `architecture:entity/example`.
- `SectionRef` identifies a section inside a view.
- Approved paths are derived from collection, containment, and slug; they are
  not the identity source of truth.

## CLI Command Surface

`packages/context-cli/src/cli.ts` wires the command tree:

| Command | Backing module | Purpose |
|---|---|---|
| `context init` | `project/workspace.ts` | Create project-local workspace files |
| `context plugin ...` | `project/pluginInstall.ts` | Install or inspect bundled agent plugins |
| `context status` | `project/status*.ts`, `project/workflow/*` | Observe facts, evaluate the Provider, and return the current route/resources |
| `context source ...` | `project/sourceCommands.ts` | Declare, inspect, and manage sources |
| `context indexer ...` | `project/indexerCommands.ts`, `project/indexer*.ts` | Confirm requirements, resolve Providers, run/recover worksets, reconcile, audit, and compile Candidates |
| `context run <phase>` | `project/run.ts` | Execute capture and any explicitly declared legacy extraction/align/compile phase |
| `context review ...` | `project/review*.ts` | Review HTML, approve/reject, re-pin, deprecate |
| `context close` | `project/close.ts` | Derive approved structure and run final checks |
| `context build` | `project/packageBuilder.ts` | Produce package output and inventory |
| `context verify` | `project/verify*.ts` | Validate approved workspace state |

All user-visible failures are normalized through `ContextError` and
`cliFeedback.ts`. Workspace routing authority is `workflow.current`; the
top-level `state`, `next`, and `routing` fields are compact projections for
human/host compatibility, not an independent state machine.

## Evidence And Source Capture

Document capture lives under `packages/context-cli/src/project`:

| Module | Role |
|---|---|
| `documentSources.ts` | File/Lark source registry helpers |
| `documentCapture.ts` | Local file capture and document-site metadata extraction |
| `documentCaptureLark.ts` | Lark document capture |
| `documentEvidenceIndex.ts` | Snapshot indexing, source refs, span lookup |
| `documentSiteDetection.ts` | Deterministic MDX/docs-site signals and route metadata detection |
| `documentSnapshotFreshness.ts` | Snapshot stale checks |

Captured evidence is addressed by canonical `source_ref` strings. Later stages
must cite these refs instead of reading raw source files directly.

## Indexer Lifecycle

The default Graph has one indexing route:

```text
Source/Capture → run-indexer-lifecycle → Indexer Candidate Review → Close → Package
```

`src/indexers.yaml` stores the confirmed requirement set and exact portable
Provider registry. `packages/context/src/indexer*.ts` defines the versioned
requirements, Provider, workset, Result, ledger, layout, audit, and Host ABI
contracts. `packages/context-cli/src/project/indexer*.ts` owns project
persistence, Provider resolution/staging, execution recovery, reconciliation,
layout/audit and Candidate compile. Provider instructions and templates live in
the bundled `context-code-indexer` and `context-markdown-indexer` Skills; the
CLI does not hard-code their editorial or technology-specific authoring logic.

The default Graph does not route through the retired extraction, prose-align,
or prose-compile authoring chains. `src/index.ts` retains capture and custom
non-knowledge orchestration only; all knowledge authoring starts from the
Indexer registry and reaches the single current Candidate path.

## Review, Approval, And Maintenance

Review is the authority boundary between draft candidates and approved
knowledge. Ordinary mode uses exact user decisions; explicitly delegated
current-conversation managed mode uses one revision-bound atomic approval.

| Module | Role |
|---|---|
| `review.ts` | Command routing for current Candidate review and approved-page maintenance |
| `reviewHtml.ts` | Browser review page generation |
| `reviewApply.ts` | Apply approved/rejected decisions |
| `reviewShared.ts` | Candidate snapshots, scope hashes, identity helpers |
| `reviewSourceExcerpts.ts` | Review evidence excerpts |
| `reviewMaintenance.ts` | Re-pin and deprecate maintenance commands |
| `candidateIdentity.ts` | Candidate/ViewRef identity helpers |

Approved Markdown stores stable identity in frontmatter and source-backed
section metadata. Candidate IDs are workflow state and must not become approved
knowledge identity.

## Close, Verify, And Structure Projection

Close rebuilds `knowledge/structure.yaml` from approved pages and their current
Indexer edges. Verify checks that approved pages, source refs, assets, and the
derived structure remain consistent. Runtime Candidate and Review state is
cleaned after successful close and is not copied into Git-tracked knowledge.

Key modules:

| Module | Role |
|---|---|
| `close.ts` | Close orchestration and receipt |
| `approvedStructureInputHash.ts` | Hash of close inputs |
| `approvedStructureEdges.ts` | Edge projection and validation support |
| `structureEdgeContract.ts` | Edge closed-set contract |
| `verify.ts` | Top-level verify orchestration |
| `verifyFrontmatter.ts` | Approved page identity/frontmatter checks |
| `verifyContextSections.ts` | Context section block parsing |
| `verifySourceRefs.ts` | Source-ref freshness and verbatim checks |
| `verifyApprovedStructure*.ts` | Structure projection and edge checks |
| `verifyProjectFiles.ts` | Workspace file traversal helpers |

Verify errors block close/build readiness. Warnings are still surfaced in status
so the agent can route maintenance tasks.

## Package Build

Build maps approved internal collections into package-facing OKF roots:

| Internal collections | OKF root |
|---|---|
| `codegraph`, `business`, `product` | `wikis/` |
| `architecture`, `sop`, `faq`, `decision`, `incident` | `guides/` |
| `standards`, `test` | `rules/` |
| `feats` | `feats/` |

Every KB package uses flat package-relative roots. A logical `wikis/index.md`
template is emitted as `dist/<package-name>/wikis/index.md`; copied knowledge,
generated indexes, links, and inventory paths use the same root contract.
Skills keep their author-maintained names. Legacy workspace declarations may
still contain `distribution.knowledgeNamespace`, but it no longer changes the
package shape.

Key modules:

| Module | Role |
|---|---|
| `okfTypes.ts` | Internal collection to OKF root/type mapping |
| `packageBuilder.ts` | Build orchestration, template rendering, fingerprinting |
| `packageIndexes.ts` | Knowledge item/group indexes |
| `packageBuildInventory.ts` | `context-build-inventory.json` |
| `packageTemplateGuard.ts` | Template grounding/boundary checks |
| `packageTemplateUtils.ts` | Template variable helpers |

The package inventory is the stable machine-readable summary for consumers. It
includes selected knowledge items, collection summaries, selected edge records,
the flat OKF root paths, and build contract metadata. Its legacy namespace field
is `null` for the current package layout.

## Code Indexing

Code knowledge is produced by the selected Indexer Provider. Parser packages
materialize structured source facts; they do not write approved knowledge.

| Package/module | Role |
|---|---|
| `packages/extract/src/protocol.ts` | Extraction protocol types |
| `packages/extract/src/runner.ts` | Plugin runner |
| `packages/extract/src/scanner.ts` | File scanning |
| `packages/extract/src/codeSnapshot.ts` | Source snapshot and symbol records |
| `packages/extract-ts/src/plugin.ts` | TypeScript extraction plugin |
| `packages/extract-ts/src/symbolExtractor*.ts` | AST symbol extraction |
| `packages/context-cli/src/project/indexerParser*.ts` | Parser planning, execution, and result import |
| `packages/context-cli/src/project/indexerCandidateCompileActions.ts` | Current Candidate materialization |

The TypeScript plugin extracts symbols, source spans, imports/exports, and code
snippets. The Provider turns authorized parser facts into current Indexer
Artifacts; Review/apply then writes readable approved knowledge pages.

## Agent Entries And Workflow Provider

The CLI plugin source lives under `plugins/context` at the repository root.
It contains one public `context` entry Skill plus manifests/assets.
It delegates workspace bootstrap to `context entry` and lifecycle routing to
Agent Graph. Build derives host-specific entries under
`packages/context-cli/dist/plugins`.

The lifecycle contract lives under `packages/context-cli/context-workflow`: a
static Agent Graph, action definitions, reason-code catalog, schemas, graph
tests, and progressively selected Markdown resources.
`packages/context-cli/src/project/workflow` observes workspace facts and binds
the selected graph action to a concrete revisioned Context command.

Important areas:

| Path | Role |
|---|---|
| `plugins/context/skills/context` | Single thin public Context entry |
| `plugins/context/assets` | Plugin brand assets |
| `context-workflow/graphs` | Stable task and gate graph |
| `context-workflow/actions` | Host-resolved action contracts |
| `context-workflow/resources` | Route-selected procedures, dialogue, diagnostics, manuals, and views |
| `context-workflow/schemas` | Machine-readable action input contracts |
| `context-workflow/tests` | Deterministic route scenarios |
| `scripts/build-plugin.ts` | Plugin marketplace build |
| `scripts/build-workflow.ts` | Provider validation and immutable bundle build |
| `project/pluginInstall.ts` | Global plugin installation and status |

The entry prompt describes only how to consume `context entry` and
`workflow.current`.
Long procedures and dialogue live in route-selected resources, while CLI code
retains mechanical validation, dynamic facts, reason codes, and commands.

## Quality Gates

Use package scripts for local validation:

```bash
bun run --cwd packages/context typecheck
bun run --cwd packages/context-cli typecheck
bun run --cwd packages/context-cli lint
bun test packages/context-cli/src/__tests__/<file>.test.ts
```

Workspace-level validation:

```bash
bun run verify
```

Installed-mode testing requires rebuilding and relinking first:

```bash
bun run build
bun run --cwd packages/dev-cli src/index.tsx link
```

## Design Boundaries

- No hosted service, storage backend, daemon, or web UI is part of this
  workspace.
- Agents should enter through a generated public command/Skill, then treat
  `context status --format json` `workflow.current` as route authority and load
  only its selected resources.
- Approved knowledge should be source-backed. Hand editing generated knowledge
  pages is a last resort and should be followed by `context verify`.
- Source names are stable evidence and phase identifiers; approved paths come
  from collection, containment, and slug.
- The package-facing surface is OKF roots (`wikis/`, `guides/`, `rules/`,
  `feats/`), while production structure uses internal collections.
