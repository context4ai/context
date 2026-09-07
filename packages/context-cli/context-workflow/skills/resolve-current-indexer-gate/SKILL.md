---
name: context-resolve-current-indexer-gate
description: Resolve the current Indexer structure or layout Gate using the exact current Route input and output schema.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: current-lifecycle
---

# Resolve the current Indexer Gate

Use this Skill only when the current Indexer Route exposes it as
`gate.resolution_action`. Read the Route input and the resolution Action output
schema before deciding.

For `stage: structure-review`, inspect the complete semantic structure Resource
and return `approved`, `exclude-obsolete`, or `request-adjustment`. Include specific feedback
when requesting adjustment.

If the preview requires obsolete-scope confirmation, explain its affected page
and file counts, mixed-current pages, and both consequences. Ask the user even
in managed mode. Include uses the supplied approval action; exclude uses the
supplied exclusion action, which retains accepted current-API groups without
asking for full repartitioning. Do not delete
sources or accepted knowledge. A non-delegatable Gate cannot be approved on the
user's behalf.
If exclusion leaves no current pages, explain that there is nothing left to
generate and stop without submitting an empty Partition or approving the old
scope. A different scope requires a new user instruction; do not manufacture
work to continue.

For `stage: layout-confirmation`, use the supplied change reports and the
user's decision. Return either `approved` or `rejected`. Include specific
feedback when rejecting. A non-delegatable layout Gate must not be approved on
the user's behalf.

Submit exactly one existing `context.indexer.current-action-input/v2` value to
the Route's completion command. Do not invent a lifecycle continuation
envelope, a second approval protocol, or additional audit data.
