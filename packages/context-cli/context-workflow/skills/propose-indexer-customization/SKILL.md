---
name: context-propose-indexer-customization
description: Propose one minimal dependency-free extend customization only after the Context CLI has emitted a final capability-gap proof.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: provider-selection
---

# Propose Indexer Customization

Read
`node_modules/@c4a/context/docs/guides/indexer-provider-and-customization.md`
and follow its six-level ladder. This Action handles the
`indexer-customization-required` outcome only; it must not reinterpret
`indexer-customization-invalid` or
`indexer-customization-upstream-changed` as permission to replace upstream
resources.

Use this Action only when its exact input is a
`context.indexer.provider-route-report/v1` whose route outcome is
`indexer-customization-required` and whose `capability_gap_proof` is present. Copy the
exact route input and report into `capability_gap`, and copy the proof's
`gap_digest` into the draft. Close every smaller ladder step in order with its
CLI/provider evidence digest. Never infer a gap from prose, a Provider manifest,
or an earlier route attempt.

Propose the smallest `extend` change that can close only the reported owner
cells and affected scopes. First close Provider-only and config levels with the
route evidence; then prefer appended instructions, one exact template
override, and a fixed local program extension in that order. Include only files
under `src/indexer/<indexer-id>/` and preserve the required Provider origin
comment. Do not create a `replace` draft, widen source scope, weaken the
requirement, or add dependency intents.

The output is an untrusted draft for the next CLI validation Action. Do not
write project source, install dependencies, execute local code, or claim that
the customization is applied. If no dependency-free `extend` can close the
exact gap, report the limitation and stop for human/dependency/program
authorization instead of emitting a conforming-looking draft.
