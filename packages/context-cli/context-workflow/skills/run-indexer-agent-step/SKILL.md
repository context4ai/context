---
name: context-run-indexer-agent-step
description: Execute one Context-authorized Indexer workset using only the current Route input and resolved Provider instructions.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: agent-step
---

# Run one Indexer Agent step

Read the current Route action input and every required Resource marked `read-required`.
Use only the materialized `resolved-indexer-instructions` content, the supplied workset,
composition input, and Context-authorized evidence. Do not discover another Skill, read a
Provider path, widen source scope, run a program, or invent missing evidence.

Return exactly `context.indexer.agent-step-result/v1`. Preserve the supplied input and
execution request digests, bind the materialized instruction payload digest, and include
the current Host execution receipt. Context performs the final schema, evidence, owner,
scope, and workset validation; never report success merely because the prose looks valid.
