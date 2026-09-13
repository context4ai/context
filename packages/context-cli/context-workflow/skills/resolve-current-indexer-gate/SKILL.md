---
name: context-resolve-current-indexer-gate
description: Present and resolve a source-update article structure proposal when selected by the current Context Gate.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: update-structure-review
---

# Resolve the current structure proposal

Read the exact Gate input and its output schema. Explain the proposed new topics,
affected existing articles, source scope and unresolved gaps in the user's
language. Reuse prior scope decisions, but wait for the confirmation required by
this Gate; managed execution does not waive a non-delegatable decision.

Submit approval or specific adjustment feedback through the returned command.
Use a temporary JSON/YAML file for long feedback. Do not invent another approval
record, change source authorization, delete articles or reconstruct an old plan.
Keep existing article identities and unaffected production tasks intact.
