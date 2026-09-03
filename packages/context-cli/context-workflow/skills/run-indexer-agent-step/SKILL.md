---
name: context-run-indexer-agent-step
description: Execute one Context-authorized Indexer workset using only the current Route input, resolved Provider instructions, and authorized workset View.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: agent-step
---

# Run one Indexer Agent step

Read the current Route action input and every required Resource marked `read-required`.
Use only the materialized `resolved-indexer-instructions`, the supplied workset authority,
and the single `authorized-indexer-workset-view`. The View already contains the exact facts,
dependencies, Provider fragments, and Author authority authorized for this workset. Do not
construct evidence read requests, manage pages or cursors, discover another Skill, read a
Provider path, widen source scope, run an unauthorized Indexer or parser, or invent missing
evidence.

Author the stage-specific operation Result described by the Action output schema. Copy dynamic
authority values only from the Route input or authorized View; in particular,
`consumed_input_view_digest` means `run_request.composition_input.view_digest`, not the
authorized View's own digest.

For an Author Result, a selected parser Fact is an immutable projection, not material for a new
Fact shape. Build it only from the matching View items:

- `fact_ref` = the `fact` item's `value.fact_ref`;
- `fact_kind` = the `fact` item's `value.kind`;
- `subject_key` = `author-authority.expected_subject_key`;
- `value` = the `fact` item's `value.payload` exactly, without wrapping, renaming, or adding fields;
- `evidence_refs` = the source-span evidence refs reached through the matching `selected-fact`
  dependency node.

Build each EvidenceBinding from that same source-span dependency's `evidence_ref`, `source_ref`,
`module_ref`, `locator`, and `content_digest`. Do not infer a new locator or digest from prose.
Do not invent or manually copy read-receipt, execution-receipt, or stable-result digests. The Host
integration must use Context's protocol builders to derive content-addressed fields and finalize
exactly `context.indexer.agent-step-result/v1`; Context then binds the CLI-issued Workset View read
receipt and performs the existing dependency, schema, owner, scope, and workset validation before
reporting success. Never report success merely because the envelope or prose looks valid.
