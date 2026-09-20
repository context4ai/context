---
name: context-resolve-current-indexer-gate
description: Present and resolve a source-update article structure proposal when selected by the current Context Gate.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: update-structure-review
---

# Resolve the current structure proposal

This structure proposal uses `context.gate.work_start_scope`; a top-level
directory change additionally uses `context.gate.top_level_directory`.

Read the exact Gate input and its output schema. Explain the proposed new topics,
affected existing articles, source scope and unresolved gaps in the user's
language. Reuse a matching prior scope decision. Ask when the proposal is complex
and changes more than five articles, or when a separate structural decision is
unresolved. Managed execution does not waive a required non-delegatable decision;
if the current Route still requires fresh feedback, wait for it.

Submit approval or specific adjustment feedback through the returned command.
Use a temporary JSON/YAML file for long feedback. Do not invent another approval
record, change source authorization, delete articles or reconstruct an old plan.
Keep existing article identities and unaffected production tasks intact.
