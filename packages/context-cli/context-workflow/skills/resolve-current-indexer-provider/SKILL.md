---
name: context-resolve-current-indexer-provider
description: Resolve the exact Host-backed Provider request selected by the current Context workflow Route.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: current-provider-resolution
---

# Resolve the current Indexer Provider

Use only the Host Action Resource required by the current Route. Materialize that Resource once and
return one `context.indexer.current-action-input/v2` value with `stage` set to
`provider-resolution` and `result` set to the complete Host Action result. If the Host also returns
the managed output named by the Route, include it as `managed_output` without changing its ref,
digest, or value.

Do not discover another Provider, substitute a version, read Provider files directly, or recreate
the Host result. Submit the value to the Route's only `complete-current` command and then follow the
newly returned Route.
