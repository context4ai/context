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

Restart or refresh the Agent host after installation. One install creates the
host-namespaced Context entry and projects `context-code-indexer` and
`context-markdown-indexer` as unnamespaced lifecycle Provider Skills for
Claude, Codex, and Cursor.

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
- new workspaces enable source-constrained editorial revisions by default;
  `context optimize-docs enable|disable` changes that workspace preference
  without modifying approved `knowledge/`;
- `context revise "<title or approved path>"` starts one conversational
  correction and routes its validation before the next package build;
- code extraction writes `knowledge/codeindex/**` and independently audits
  source analysis, stable-boundary coverage, content density, evidence scope,
  and page size before Review; legacy `codegraph` workspaces migrate through
  the returned Route action;
- the `context indexer` lifecycle builds contract-derived question targets,
  digest-bound partition and author worksets, exact SubjectKey resolution
  views, and independent post-author composer worksets. Main runs use a local
  content-addressed ledger whose accepted Result/receipt transition is atomic;
  ordinal/fixed-count partitions advance through the authorized strategy order,
  and exhausted strategies use a persisted-predecessor CLI catalog fallback that
  creates one parent unit without an Agent or user Gate;
  post-author runs use a separate ledger and atomic envelope record. Observe
  commands publish pending/accepted/failed/stale counts and never use numeric
  cursors. Reconciliation then recomputes every required coverage domain from
  current owner cells, accepted author Results, registered materials, and the
  complete CLI-owned question-target set; capability or material gaps cannot be
  reported as complete;
- the `markdown-provider` Indexer Route starts only from exact current document
  capture. Agent discovery reports visible `context-markdown-indexer*` Skills
  without persisting the discovery list; the CLI recomputes the route and
  static validation, resolves and stages exact CLI-bundled Bundles, and stops
  external resolution or local customization at explicit Host/customization
  Outcomes;
- `route-index-requirement-confirmation` recomputes the canonical requirement
  comparison before routing. Ordinary confirmation may use its explicit
  authority, while contraction or incomparable obligation replacement always
  enters the human-only Gate. `validate-subject-key-schemas` likewise requires
  an exact Provider-major re-identification authorization for identity-breaking
  changes over approved Nodes; incomplete, split, merged, or colliding mappings
  fail before that Gate. Exact target matches that resolve to multiple Nodes
  return `index-target-resolution-ambiguous`, and invalid reuse returns
  `index-target-resolution-invalid`;
- unresolved material questions are checkpointed only as local runtime recovery
  state. Newly captured Markdown or other authorized material reruns the normal
  main Indexer path and updates the same Candidate; there is no answer-only
  operation or second Review Route;
- main Candidate Review has one Graph predecessor:
  `inspect-index-candidate-review-readiness`. The CLI accepts only digests of
  content-addressed precompile/postcompile audit records and verifies their
  requirement, registry, inventory, layout, candidate-set, and effective
  revision bindings. Missing, stale, baseline-failed, or profile-blocked audits
  cannot resolve the Review Gate. A profile failure enters
  `revise-index-output`; `record-index-profile-revision` retains a stable
  problem lineage and at most three distinct result fingerprints. After the
  third failure, `report-index-profile-failure` persists the full metrics,
  examples, history, missing inputs, and capability-loss report.
  `inspect-index-profile-failure` is read-only, and the following
  `override-index-profile-audit` Gate is non-delegable. Its receipt binds the
  report, audit, candidate revision, failed metrics, user, and timestamp.
  Baseline failures cannot issue or consume that receipt;
- `checkpoint-material-gaps` writes the current unresolved set under `.tmp` for
  recovery and stale-write rejection. `audit-material-gap-state` is read-only;
  required gaps block close, and `close-indexer-approved-knowledge` writes only
  the approved structure before clearing completed runtime lifecycle state;
- `context clean-cache --dry-run` previews cleanup of Context-owned stale
  plugin caches.

Revision-bound commands should be copied from `workflow.current`; examples in
documentation are orientation, not a substitute for the current Route. See the
[installed quickstart](./docs/quickstart.md) and
[debug tracing guide](./docs/debug-tracing.md).
See also [source-constrained editorial revisions](./docs/document-optimization.md).

## Documentation and development

- [Plugin contract](../../plugins/context/README.md)
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

Build generates installable host projections under `dist/plugins` and the
direct-Git projection under `../../plugins/context/repo-install`; edit only
`../../plugins/context/` and the bundled workflow source, never generated output.

## License

MIT.
