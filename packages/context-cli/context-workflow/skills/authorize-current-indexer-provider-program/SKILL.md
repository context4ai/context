---
name: context-authorize-current-indexer-provider-program
description: Resolve the current Context Gate for an exact non-sandboxed Indexer Provider program.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: current-provider-program-authorization
---

# Authorize the current Provider program

Read the exact program report in `gate.resolution_action.input`. Resolve only the current Gate:

- return `stage: provider-program-authorization`;
- return `decision: approved` only when the user approved it or the Route says the Gate is resolved
  by session authority;
- otherwise return `decision: rejected`.

Do not change Provider identity, program content, scope, limits, or authority. Submit the value to
the Route's only `complete-current` command and then follow the newly returned Route.
