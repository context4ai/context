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
and return either `approved` or `request-adjustment`. Include specific feedback
when requesting adjustment.

For `stage: layout-confirmation`, use the supplied change reports and the
user's decision. Return either `approved` or `rejected`. Include specific
feedback when rejecting. A non-delegatable layout Gate must not be approved on
the user's behalf.

Submit exactly one existing `context.indexer.current-action-input/v2` value to
the Route's completion command. Do not invent a lifecycle continuation
envelope, a second approval protocol, or additional audit data.
