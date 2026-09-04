---
name: context-run-indexer-lifecycle
description: Continue the sole Context registry-and-Provider indexing route; use only when the workspace Graph selects route.indexer.lifecycle-required.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: workspace
  agent-graph.entry: context
---

# Run The Indexer Lifecycle

This Action continues the sole registry-and-Provider indexing route. Use the
current Indexer subroute for semantic partitioning, structure review, authoring,
composition, layout, Candidate compilation, and repair. Existing approved
knowledge is an input to incremental planning, never a parallel authoring path.

Read
`node_modules/@c4a/context/docs/guides/indexer-provider-and-customization.md`,
then follow the root `context` Skill's Indexer instructions and the exact
structured outcomes returned by `context indexer ...`. Start by forming and
confirming requirements when `src/indexers.yaml` is absent or stale; otherwise
continue the current registry selection, Provider resolution, execution,
reconciliation, mechanical validation, layout, and Candidate compile subroute. The Indexer
Graph is the authority for each substep. Never skip directly to compile and
never synthesize a Provider Result or a default plan.

Stop on the first Host permission, non-delegatable Gate, validation failure, or
human decision. Once current Candidates have been compiled, return control to
`context status --format json`; the workspace Graph will select Knowledge
Review. The Action output is only:

```json
{
  "protocol": "context.indexer.lifecycle-continuation/v1",
  "outcome": "follow-indexer-route"
}
```
