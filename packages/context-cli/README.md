# Context CLI

[简体中文](./README.zh-CN.md)

`@c4a/context-cli` provides the **Context CLI** and the global Agent plugin
installer. The CLI manages project-local workspace state; the Agent plugin
explains that state, asks for user decisions, and edits project configuration.

The CLI is Node/Bun compatible and does not call an LLM. Mechanical work belongs
to the CLI, semantic judgment belongs to the Agent, and important decisions
belong to the user.

Markdown parsing is structural only: source headings remain inside citeable
evidence spans, while their meaning, grouping, and knowledge type are never
inferred by the CLI.

## Install

```bash
npm install -g @c4a/context-cli
context plugin install
```

Global package installation also attempts a best-effort plugin refresh. Run
`context plugin install` again after installing or upgrading Claude or Codex,
then restart the Agent.

The public Agent entries are:

- `/context:init` creates a project-local Context workspace.
- `/context:continue` reads the current workspace state and continues from the
  next action.

`/context:continue` is Agent guidance, not a CLI subcommand. There is no
`context continue` command.

For the shortest installed-package walkthrough, read
[CLI Quickstart](./docs/quickstart.md).

Workspace tracing is off by default. Use `context init context --debug` or
`context debug enable` only when command and Agent Graph route observability is
needed; logs stay under ignored `.tmp/context-runtime/debug/`. See
[Workspace debug tracing](./docs/debug-tracing.md).

## CLI And Agent Responsibilities

| Responsibility | Owner |
|---|---|
| Source registries, capture, extraction, review application, verify, and build | CLI |
| Explaining choices, editing `src/index.ts`, proposing structure, and generating candidates from evidence | Agent |
| Source permission, classification, review decisions, and package-output choice | User |

The Agent treats `context status --format json` `workflow.current` as the
current-step authority rather than guessing the next command. The default JSON
view is compact: it contains the route, required resource locations, progress,
counts, and aggregated diagnostics. Use `--view full` only for debugging. Long
procedures and semantic rules remain complete Markdown resources selected by
the route; progressive loading does not shorten or discard them.

## Create Or Continue A Workspace

```bash
# Create a standalone workspace.
context init context
# Use --language zh-CN when generated workspace and starter templates should be Chinese.
cd context
bun install

# Ask the Agent to continue from the current state.
/context:continue
```

The generated `AGENTS.md` is the Agent's project-local operating guide. After
dependency installation, SDK manuals are available at:

```text
node_modules/@c4a/context/docs/README.md
node_modules/@c4a/context/docs/guides/agent-guide.md
node_modules/@c4a/context/docs/reference/project-api.md
node_modules/@c4a/context/docs/reference/package-templates.md
```

The workspace state is split across:

- `src/` for project declarations and package templates.
- `sources/` for source registries and captured evidence.
- `.tmp/context-runtime/lifecycle/` for ignored, CLI-managed draft candidates and
  confirmed structure snapshots during an open lifecycle round.
- `knowledge/` for approved Markdown, the closed `structure.yaml` projection,
  and the minimal `decisions.json` rejected-candidate fingerprint map when one
  exists. Resources referenced by approved pages live in content-addressed
  `knowledge/assets/` paths.
- `dist/` for generated package output.
- `.tmp/context-runtime/` for other ignored logs, previews, reports, locks, and caches.

The lifecycle and review runtime state is not user-editable and is removed by a
successful `context close`. `knowledge/structure.yaml` is the durable approved
structure projection. Its minimal `source_inputs` entries record only the
source, collection, and source snapshot consumed by a closed prose target, so a
clean workspace can distinguish completed and changed inputs after transient
snapshots are removed. `knowledge/decisions.json` only preserves rejected
candidate IDs and their fingerprints so unchanged candidates are not offered again.

Do not repair lifecycle state by manually deleting or rewriting these
directories. Use the command or next action returned by the CLI.

## Package Output

`context build` writes each declared package under `dist/<package-name>/`.
KB packages use flat, package-relative OKF roots: `wikis/`, `guides/`,
`rules/`, and `feats/`. The package name already identifies the surrounding
`dist/<package-name>/` directory and is not repeated inside those roots. Older
workspaces that still declare `distribution.knowledgeNamespace` remain
loadable, but the legacy value no longer changes package paths.
New KB setup should offer Git raw resource delivery first. Build rewrites links
to repository raw URLs; committing and publishing the resources remains the
package author's responsibility. An explicit `urlPrefix` also works when the
Context workspace itself is outside Git. Without Git or an explicit prefix,
authors can bundle resources under `others/assets/` or explicitly omit them and
retain unresolved references.
Bundled delivery may configure `kbPackage().assets.optimize`; Context itself
does not depend on an image processor.

See the SDK manuals for the complete configuration and template contract:

- [Package outputs](../context/docs/guides/package-outputs.md)
- [Package templates](../context/docs/reference/package-templates.md)

## Status-Driven Workflow

The project workflow is declared in `src/index.ts` and routed by the bundled
Context workflow graph behind `context status`. This graph is an internal CLI
implementation detail; Context users and plugins consume only
`workflow.current`, Context commands, and the selected resources:

| Stage | CLI surface |
|---|---|
| Source setup | `context source add repo/file/lark`, `context source add batch`, and `context source ensure` |
| Document capture | Declared capture phases through `context run <phase-id>` |
| Code extraction | Declared `extractTs` phases through `context run <phase-id>` |
| Prose structure | `context run align:<type>:<source>:<collection> ...` evidence and validation views |
| Prose compile | `context run compile:<type>:<source>:<collection> ...` evidence and validation views |
| Review | `context review html`, scoped decisions, and `context review apply` |
| Close and quality | `context close` and `context verify` |
| Package output | `context build` |

Building a package completes the currently active approved state; it does not
freeze the workspace. New sources can be added and processed later.

With explicit current-conversation managed authority,
`context run --managed --until blocked-or-complete` keeps one workspace-bound
runtime for consecutive deterministic actions. Each action remains bound to
the Route revision that selected it; after the action, Context reloads the
project from disk and evaluates the graph again. Known local actions run in the
same process, while source tools and other external effects remain isolated in
child processes.

The runtime scope owns only short-lived resources such as output capture,
timers, child processes, and write locks, and releases them in reverse order.
Knowledge, snapshots, decisions, and package output are durable state: they
retain their existing revision checks, project write lock, atomic write, close,
and verify contracts. No execution scope rolls back or substitutes those
contracts, and the workspace file protocol is unchanged.

## Command Groups

```bash
# Plugin installation and diagnostics
context plugin install
context plugin status

# Workspace creation and state
context init [project-dir]
context status
context run --managed --until blocked-or-complete --format json

# Route-selected resources
context resource materialize --help
context resource acknowledge-current --help

# Sources
context source add repo [YYYYMMDD] --module <module> --local <repo-or-subdir>
context source add file [YYYYMMDD] --module <module> --local <file-or-folder>
context source add lark [YYYYMMDD] --module <module> --url <lark-url>
context source add batch [YYYYMMDD] --input <yaml-or-json>
context source remove <source-id> --format json          # preview
context source remove <source-id> --yes --plan-digest <preview-digest> --format json
context source ensure [source]
context source inspect [source]

# Declared phases and review
context run --list
context run <phase-id> --dry-run
context run <phase-id>
context review html [collection] --open
context review apply <payload-file>

# Package template decisions
context package template accept --help

# Final quality and output
context close
context verify
context build

# Optional workspace tracing
context debug enable
context debug status
context debug export

# Development/cache maintenance
context clean-cache --dry-run
```

Run `context <command> --help` for current flags. Commands that require a
workspace search upward for a `package.json` with `context.project=true` and a
configured `context.entry`. Revision-bound resource and package commands should
normally be copied from `workflow.current`; the examples above show their
discovery surface rather than a replacement for the current route.

## Human Gates And Evidence

- The CLI never silently clones, checks out, resets, fetches, installs, builds,
  or runs scripts in a source repository.
- Source registration and source-body reading are separate permissions.
- Extraction scope and document classification are confirmed before candidate
  writes.
- In ordinary mode, Review decisions come from the user and the Agent must not
  invent payloads. Explicit current-conversation fully managed mode uses only
  the atomic approval command returned by `workflow.current`.
- Package output is chosen after approved knowledge exists; package templates
  are project configuration, not a second factual source.

CLI-returned source names, phase IDs, candidate IDs, diagnostics, and
`source_ref` values are workflow tokens. A `source_ref` is an opaque evidence
citation: copy it exactly and do not parse it as a filesystem path.

## Further Reading

- [CLI Quickstart](./docs/quickstart.md)
- [SDK documentation index](../context/docs/README.md)
- [Getting Started](../context/docs/getting-started.md)
- [Agent Guide](../context/docs/guides/agent-guide.md)
- [Agent Dialogue](../context/docs/guides/agent-dialogue.md)
- [Lark Resource Materialization](../context/docs/guides/lark-resources.md)
- [Project API](../context/docs/reference/project-api.md)
- [Package Templates](../context/docs/reference/package-templates.md)

## Development

For the complete source, link, plugin, and npm-mode workflow, see
[`DEVELOPMENT.md`](../../DEVELOPMENT.md) and this package's
[`DEVELOPMENT.md`](./DEVELOPMENT.md).

```bash
./start.sh link
bun run --filter @c4a/context-cli build
bun run --filter @c4a/context-cli typecheck
bun run --filter @c4a/context-cli lint
bun run --filter @c4a/context-cli test
```

Build writes the installable Claude, Codex, Cursor, and skill-only trees to
`dist/plugins`. `context plugin install` installs from that package-bundled
output. Do not edit generated plugin trees directly.

## License

MIT.
