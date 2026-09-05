---
name: context-run-indexer-agent-step
description: Execute one bounded batch of Context-authorized Indexer worksets using the current Route input, shared Provider instructions, and each task's authorized View.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: agent-step
---

# Run one bounded Indexer Agent batch

Read the current Route action input and every required Resource marked `read-required`.
Use only the materialized `resolved-indexer-instructions`, the supplied transport worksets,
and each task's `authorized-indexer-workset-view/task-NNN`. Match Views and outputs only through
the short `task_key`; do not copy internal digests into the semantic result. Each View contains the
exact facts, dependencies, Provider fragments, and Author authority authorized for that task. Do not
construct evidence read requests, manage pages or cursors, discover another Skill, read a
Provider path, widen source scope, run an unauthorized Indexer or parser, or invent missing
evidence.

Return exactly one `results[]` entry for every task in the current batch, in task-key order. Each
entry carries its `task_key` and the existing stage-specific semantic Result. A single-task batch
still uses the same array shape. Copy dynamic authority values only from the Route input or that
task's authorized View.

For a Partition Result, read `partition-authority` before choosing each group subject. A string
changes only the local key and preserves `base_subject_key` namespace and kind. Use an explicit
subject object only when its kind is listed in `subject_key_contract.kinds`; never invent a kind
from a page title, operation name, framework term, or business vocabulary.

`subject_intent` describes the reader-subject outcome, not the source file's role. Use `primary`
when the group owns a reader subject. Use `enrich-or-independent` for a publishable supplemental
view such as test or example behavior: Context reuses a matching subject when available and creates
an independent subject otherwise. Do not emit `supporting`; material that must never become a reader
subject must not be emitted as a group.

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
For behavior, read the Author View's `source-text` items. Their `spans` contain the authorized
source lines; `source_span_refs` link back to existing dependency nodes, not new evidence identities.
Overlapping ranges appear once. A signature or call name alone does not establish behavior absent
from those lines. Do not copy these process-only carriers into reader Markdown.
Do not invent or manually copy read-receipt, execution-receipt, or stable-result digests. Submit
exactly `context.indexer.current-action-input/v2` through the Route's completion command; Context
derives internal envelopes and performs dependency, schema, owner, scope, and per-workset validation
before reporting each task accepted. Read the completion's `outcomes`, then continue directly from
its `next` Route and ready Resource paths. Do not run `context status` or either Resource materializer
between successful batches. A failed item is retried from its returned task-only skeleton; already
accepted peers are not repeated. Never report success merely because the envelope or prose looks valid.
