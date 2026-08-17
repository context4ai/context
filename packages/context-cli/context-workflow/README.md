# Context Workflow Provider

This directory is the source form of the workflow contract embedded in
`@c4a/context-cli`.

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
