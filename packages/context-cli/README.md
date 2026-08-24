# Context Agent Runtime

[简体中文](./README.zh-CN.md)

`@c4a/context-cli` ships the local runtime and Agent integration for the
Context knowledge production workflow. Despite the package name, its primary
user experience is not a terminal command catalog: users invoke one Agent
entry, describe the knowledge they want, and follow the decisions explained in
conversation.

The runtime performs deterministic work—workspace observation, source capture,
code indexing, evidence validation, candidate staging, review application,
verification, and package builds. The Agent performs semantic work, while the
user owns permissions and important content decisions. The runtime never calls
an LLM itself.

## Install the Agent integration

```bash
npm install -g @c4a/context-cli@latest
context plugin install
```

Restart or refresh the Agent host after installation. The bundled installer
projects the same source entry into supported Claude, Codex, Cursor, and
Skill-compatible layouts.

The public community entry is `/c4a:context`. It creates a requested workspace,
locates an existing workspace, or resumes the current workflow. Users should
start with intent, not internal commands:

```text
/c4a:context Turn these product documents and this repository into a reviewed
Agent knowledge package. Keep every code claim traceable.
```

If the Agent entry is present but the `context` executable is missing, the
entry reports the exact installation recovery and stops. It does not run an
installation preflight on every request and does not confuse a normal workflow
`not found` diagnostic with a missing executable.

## How one Agent entry drives the workflow

```text
User knowledge goal
        ↓
single Agent entry
        ↓
context entry ── observes workspace location and state
        ↓
workflow.current ── current Route, resources, Gate, exact commands
        ↓
Agent reads / decides / executes one selected action
        ↓
workspace facts change ── evaluate again
```

`context entry --format json` is the read-only bootstrap resolver. It can
return an initialization action, a workspace relocation action, or the current
workflow evaluation. There is no `context continue` primitive and no separate
public entry for source, review, build, or status.

Once a workspace is ready, `workflow.current` is the current-step authority:

- required resources marked `read-required` are read completely before acting;
- only Route-returned commands are executed, with their revision and authority
  arguments preserved;
- human Gates explain the decision and its impact before collecting a choice;
- project configuration changes are limited to the file named by the Route;
- every action is followed by a fresh observation, so stale commands cannot
  advance a changed workspace.

Long procedures, schemas, diagnostics, and source views remain addressable
files in the bundled workflow. The Agent loads only what the current Route
selects instead of carrying the entire lifecycle in its prompt.

## The knowledge production lifecycle

| Phase | What the user experiences | What the runtime protects |
|---|---|---|
| Goal and sources | Confirm what knowledge is needed and which materials are in scope | Source identity, permission boundary, pinned repository or document inputs |
| Capture and extraction | The Agent reads documents or inspects a confirmed code boundary | Complete bodies, resources, symbols, relations, fingerprints, and freshness |
| Structure and compile | Review the proposed knowledge organization and content | Source-bound Nodes and Sections, coverage, continuity, and stable identities |
| Review and close | Approve, reject, or adjust the candidate set | Atomic review application, durable decisions, and closed structure projection |
| Verify and build | Choose an output and receive a reusable package | Validation, package templates, asset policy, and build inventory |

Building completes the currently approved state; it does not freeze the
workspace. New or changed sources can open another production round later.

## Ordinary and fully managed conversations

Ordinary mode is the default. It preserves explicit source, scope, structure,
review, and package decisions and can provide HTML inspection reports at
content-review Gates.

When the user explicitly authorizes fully managed operation for the current
conversation, the Agent uses:

```bash
context run --managed --until blocked-or-complete --format json
```

This collapses consecutive deterministic actions and delegated Gates, then
stops when Agent reading, project configuration, additional permission,
diagnostic repair, or a non-unique plan needs attention. It reuses the same
workflow Graph and does not remove ordinary-mode review capability. The
authority is conversation-scoped; it does not persist and cannot authorize new
source boundaries, unread external content, repository operations, failed
validation, or failed verification.

## Workspace state

```text
context/
├── src/                         # declarative project and package templates
├── sources/                     # source registry and captured evidence
├── knowledge/                   # approved Markdown and durable decisions
├── dist/                        # built packages
└── .tmp/context-runtime/
    ├── lifecycle/               # open-round candidates and structure
    ├── debug/                   # optional traces
    └── logs/                    # optional runtime-event outbox
```

These directories have different durability contracts. `sources/` and
`knowledge/` are project state; `dist/` is reproducible output; lifecycle and
debug directories are ignored runtime state. A successful close removes the
completed lifecycle staging area. Do not repair a workflow by manually editing
or deleting CLI-owned state—use the recovery action returned by the current
Route.

## Evidence and safety boundaries

- Source registration does not grant permission to read source bodies.
- The runtime does not silently clone, checkout, reset, fetch, install, build,
  test, or run scripts in a source repository.
- Markdown parsing preserves structural evidence but does not infer product
  meaning or choose a knowledge collection.
- Code extraction emits structural facts; the Agent and user decide their
  knowledge meaning and scope.
- `source_ref` values are opaque, verified evidence identities. Copy them
  exactly rather than treating them as filesystem paths.
- Review decisions become approved Markdown only through atomic review apply;
  Agents do not hand-write lifecycle output.
- Package templates shape distribution but never replace approved knowledge as
  the source of truth.

## Package output

Declared packages are built under `dist/<package-name>/`. Agent knowledge
packages may contain `wikis/`, `guides/`, `rules/`, `feats/`, Skills, indexes,
and package-specific retrieval helpers. LLM packages consolidate selected
knowledge into a text artifact.

Each build inventory maps the distributed paths back to approved workspace
knowledge. Asset delivery can use repository raw URLs, an explicit URL prefix,
or bundled assets; the project chooses the policy before build.

See [Package Outputs](../context/docs/guides/package-outputs.md) and
[Package Templates](../context/docs/reference/package-templates.md).

## Diagnostics and direct CLI use

Normal users should follow the Agent entry. Direct commands remain available
for maintainers, automation, and diagnostics:

- `context status --format json` inspects the current Route;
- `context <command> --help` is the authority for current flags;
- `context plugin status` checks installed Agent projections;
- `context debug enable` records optional traces below
  `.tmp/context-runtime/debug/`;
- new workspaces enable conservative document revisions by default;
  `context optimize-docs enable|disable` changes that workspace preference
  without modifying approved `knowledge/`;
- `context revise "<title or approved path>"` starts one conversational
  correction and routes its validation before the next package build;
- `context clean-cache --dry-run` previews cleanup of Context-owned stale
  plugin caches.

Revision-bound commands should be copied from `workflow.current`; examples in
documentation are orientation, not a substitute for the current Route. See the
[installed quickstart](./docs/quickstart.md) and
[debug tracing guide](./docs/debug-tracing.md).
See also [document revisions](./docs/document-optimization.md).

## Documentation and development

- [Plugin contract](./plugin/README.md)
- [Workflow Provider internals](./context-workflow/README.md)
- [SDK documentation index](../context/docs/README.md)
- [Knowledge-project walkthrough](../context/docs/getting-started.md)
- [Agent Guide](../context/docs/guides/agent-guide.md)
- [Project API](../context/docs/reference/project-api.md)

For source, link, packaged-install, and release workflows, see
[`DEVELOPMENT.md`](../../DEVELOPMENT.md) and this package's
[`DEVELOPMENT.md`](./DEVELOPMENT.md).

```bash
bun run --filter @c4a/context-cli build
bun run --filter @c4a/context-cli typecheck
bun run --filter @c4a/context-cli lint
bun run --filter @c4a/context-cli test
```

Build generates the installable host projections under `dist/plugins`; edit
only `plugin/` and the bundled workflow source, never generated output.

## License

MIT.
