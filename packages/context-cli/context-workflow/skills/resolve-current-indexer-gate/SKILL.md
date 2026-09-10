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

If the preview requires obsolete-scope confirmation, compare the affected
pages/files and mixed-current pages with the user's current request, existing
requirements and applicable work-start report. Reuse an explicit include/exclude
decision for the same scope. When the user explicitly delegated this scope choice,
make a reasoned recommendation and apply it within that delegation. A generic
managed/no-review instruction, source-read permission or silence does not choose
whether to include old APIs. A delegatable Gate permits authorized judgment; it
does not supply missing scope authorization.

If no applicable decision or delegation exists, explain the counts and both
consequences briefly, recommend an option, ask the user and wait before submitting.
Report this as a pending scope question, not a tool failure or an issue requiring
CLI repair. Revisit a prior decision only when newly discovered content materially
changes its scope or consequences. Do not request the same approval twice.

Keep the decision and rationale in existing requirements/report when applicable,
without inventing an authorization flag or a separate decision ledger. Inspect
the full structure: these actions also approve it, so ordinary structure review
still requires the user's approval unless its review authority was delegated.
Include uses the supplied approval action; exclude uses the supplied exclusion
action, retaining current API groups without full repartitioning. Do not delete
sources or accepted knowledge. Use only the current revision and supplied action.
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

For a topic carrying `scope_change`, its old title/task/outline may no longer fit
its remaining members. Inspect those members explicitly rather than approving
all titles by count. Author receives the same change and may choose a justified
page form or a non-publishing result; exclusion does not establish usefulness.
