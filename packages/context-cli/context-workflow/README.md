# Context Workflow Provider

[简体中文](./README.zh-CN.md)

This directory is the source form of the workflow contract embedded in
`@c4a/context-cli`.

The Provider turns a long knowledge production lifecycle into fact-selected,
testable Routes. It does not contain knowledge content and does not perform
semantic judgment. Instead, it decides which task category is legal now, which
resources the Agent must read, which Gate is unresolved, which exact host
action may execute, and what workspace facts should be observed afterward.

```text
workspace facts → Agent Graph Route → resources / Gate / Action
       ↑                                      ↓
       └──────── observe after execution ─────┘
```

It is intentionally internal to Context:

- Context users and Agent Skills invoke only `context` commands.
- The Provider graph contains stable task categories, never source names,
  phase IDs, collections, dates, or module names.
- `src/project/workflow/` observes a workspace and supplies the current facts.
- Host handlers resolve a stable graph action to the concrete Context command
  from the same observation and revision.
- Procedures, diagnostics, schemas, and templates are files referenced by the
  graph. Long operating instructions do not belong in TypeScript route
  branches or entry Skills.
- `scripts/build-workflow.ts` validates this source and emits one immutable
  bundle under `dist/providers/context/`.

The public lifecycle remains a Context product contract. The generic graph
protocol and its commands are not a user-facing dependency.

## Source layout

| Path | Responsibility |
|---|---|
| `provider.yaml` | Provider identity, graph catalog, and exported resources |
| `graphs/workspace.yaml` | Stable knowledge-work task categories and legal transitions |
| `graphs/indexer.yaml` | Digest-bound Indexer selection, execution, reconciliation, and gap subroutes |
| `actions/` | Action contracts resolved by the Context host adapter |
| `resources/` | Procedures, dialogue, diagnostics, manuals, schemas, and dynamic-view definitions |
| `schemas/` | Structured Agent payload contracts |
| `tests/` | Fact-to-Route scenarios that run without a model |
| `scripts/build-workflow.ts` | Validation and immutable bundle generation |

Current source names, dates, modules, collections, and phase ids are runtime
facts. They must not become graph nodes or hard-coded prompt state.

## Runtime invariants

The Provider is considered valid only when all of the following are true:

1. Workspace route selection is produced by this graph from normalized Context
   facts.
2. Every write route is resolved from the same observation and revision that
   produced it, and stale routes are rejected before execution.
3. Session-managed mode only resolves explicitly delegatable gates and never
   changes source, validation, close, or verification facts.
4. Public Agent entries are thin Context shells. Procedures, dialogue,
   diagnostics, schemas, and templates are discovered from the shipped
   Provider bundle.
5. Dynamic context views are read-only, content-addressed, and do not acquire a
   lifecycle write lock. Their read freshness follows the rendered content
   digest, while lifecycle commands remain bound to the current Route revision.
6. Source-dev, link, pack, and npm installs resolve the same Provider semantics
   without absolute build-machine paths.
7. No Context workspace contains or needs a graph manifest or graph runtime
   directory.
8. Provider graph tests, Context adapter tests, lifecycle tests, bundle
   integrity tests, and packaged-install smoke tests all pass.
9. A phase-local `next_action` may continue only the operation that produced
   it. Once that operation completes, the result returns
   `reevaluate_workspace_route`; only `workflow.current` may choose another
   lifecycle stage.
10. A semantic resource file owns its resource metadata, including
    `applies-to`. TypeScript may select resources for the current node, but
    must not duplicate the shipped semantic-resource path inventory.
11. Managed run-to-completion is a host loop over this same graph, not another
    route selector. It may execute only one immediate non-read command, then
    must re-observe and re-evaluate before the next command.
12. Document interpretation routes expose captured Markdown bodies as static,
    content-addressed resources. Resource receipts prove only that exact bytes
    were delivered and read in the current conversation; indexes never count as
    body reads, and the CLI never judges source meaning.
13. A Route returns one `resources.after_read.command` for all direct required
    files. Dynamic resource materialization returns its own local receipt-set
    file and exact post-read command. The Agent reads the selected files, then
    executes the matching command; direct-resource acknowledgement returns the
    re-evaluated Route in the same response, and unchanged content remains
    current across unrelated workflow revisions.
14. The managed host runtime may reuse one process only for commands whose
    exact argument shape is recognized and whose effect is not external.
    Unknown shapes and external effects execute in a child process. Both paths
    return the same receipt contract and re-enter graph evaluation afterward.
15. An execution scope owns runtime resources, never durable workspace state.
    Output interception, child processes, timers, and write locks are released
    deterministically; knowledge mutations remain revision-checked,
    write-locked, and atomically committed by their existing command handlers.
16. Every complete code-index batch receives one Agent semantic audit before
    knowledge Review. CLI signals remain advisory evidence, but the Agent must
    choose accept, revise, or request-input. Fully managed work revises real
    issues and repeats Preview/extraction/audit until accepted. The complete
    report stays in the workspace; package inventory carries only a compact
    audit summary and no report file is published.
17. The Indexer graph advances from partition to author work only through
    CLI-validated workset-set Facts. Exact SubjectKey resolution happens before
    authoring; post-author composers receive only a bounded PrimaryResultView,
    and reconciliation is unreachable until the independent composer set is
    either explicitly not required or fully accepted with a current envelope.
18. Main Indexer dispatch first recovers a local content-addressed run ledger.
    Context exposes one Host-managed Authorized Workset View for the exact run;
    the Agent does not manage evidence-specific readers, cursors, or receipts.
    The Host mechanically binds the CLI-issued exact-read receipt to the Result.
    A validated Result, its read receipts, and the accepted transition share one
    durable journal; interrupted running work returns to pending, while a complete
    accepted cache hit, including an empty Result, is not dispatched again.
    Ordinal/fixed-count partition output advances to the next authorized strategy.
    Once those strategies are exhausted, the graph starts a release-bound CLI
    catalog-fallback request and mechanically accepts one parent unit; a persisted
    exhausted-convergence predecessor is mandatory and no Agent or user Gate is used.
19. Post-author composers use a separate local ledger. Accepted composer Results
    and receipts survive process recovery independently; a current envelope is
    published atomically only after the complete set is accepted. If only the
    envelope pointer is absent, composition is replayed without rerunning a composer.
20. Result reconciliation is a CLI-owned completion boundary. It recomputes
    required-domain owners, consumes only accepted author-store Results, enumerates
    every current question-target pair, and turns omitted pairs into material gaps.
    Missing owners, missing accepted cache, unsupported targets, or blocking
    material gaps cannot reach reconciliation readiness or a complete report.
21. Material gaps are runtime recovery state, not a second authoring product or
    a user Review surface. `checkpoint-material-gaps` records only the current
    unresolved requirements under `.tmp`; it never writes answer bodies, source
    spans, approval receipts, or audit history into knowledge state.
22. Newly captured Markdown or other authorized material re-enters the ordinary
    main Indexer path. The same Result reconciliation either closes the question
    from current source or keeps it unresolved. There is no answer-only operation,
    planned landing, post-layout actualization, or second content Review.
23. `audit-material-gap-state` recomputes expected unresolved gaps without writing.
    Final close is allowed only when no required gap remains, writes only the
    approved knowledge structure, and then clears completed runtime lifecycle
    state. Optional unresolved gaps do not become published knowledge metadata.
24. Requirement confirmation always uses the CLI-recomputed canonical comparator.
    Ordinary changes may use only their explicit session authority; contraction
    and incomparable obligation replacement enter a non-delegable human Gate.
25. SubjectKey schema authority is resolved from the CLI base contract or the one
    owning extension Provider. Identity-breaking changes over approved Nodes need
    a Provider major and one exact human re-identification authorization; invalid
    mappings fail before the Gate. Ambiguous and invalid target resolution are
    typed blocking/failure Outcomes and cannot enter author work.
26. The Markdown Provider Route starts by proving current document capture,
    then separates Agent-only visible-Skill discovery from CLI routing, static
    validation, resolution, staging, and final validation. CLI-bundled Bundles
    may complete automatically; external Bundles return a Host-action resource request and
    project customization returns its own blocking Outcome. Host re-entry carries
    only structured Host results; the CLI owns all staged paths.

## Managed host-loop receipts

`context run --managed --until blocked-or-complete --format json` returns
`context.workflow.run.v1`. `state` reports `complete`, `blocked`, `planned`,
`failed`, or `max-steps`; `stop.reasonCode` identifies why execution ended.
This is the default conversational entry after the user explicitly grants
fully managed authority; it is not used without that current-conversation grant.
Each projected command declares `managed_execution=automatic|agent-required`;
the loop never infers automation eligibility from a command name.
The loop stops mechanically on configuration, diagnostics, unresolved
authority, unread required Agent resources, read-only interpretation,
non-unique commands, command failure, timeout, no progress, or its explicit
step budget. Recommended resources never block deterministic execution. It
does not inspect source meaning or choose a semantic branch.
