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
Use the readable `resolved-indexer-instructions` and each task's
`authorized-indexer-workset-view/task-NNN`, including its goals, constraints and source material.
Author task Resources can point to the same batch file: read that path once. Read shared
material once for its listed tasks, then focus on each task's distinct sources and reader goal.
If the file tool truncates its output, continue with the unread part of that same file;
do not mistake tool truncation for missing source material or restart the Context task.
Match Views and outputs only through
the short `task_key`; do not copy internal digests into the semantic result. The reading contains the
source material, supplementary facts, Provider fragments, and authority needed for each task. Do not
construct evidence read requests, manage pages or cursors, discover another Skill, read a
Provider path, widen source scope, run an unauthorized Indexer or parser, or invent missing
evidence.

Return exactly one `results[]` entry for every task in the current batch, in task-key order. Each
entry carries its `task_key` and the existing stage-specific semantic Result. A single-task batch
still uses the same array shape. Prepare distinct results together and submit the batch once;
do not turn it into a separate CLI round trip for each page. Copy dynamic authority values only from the Route input or that
task's authorized View.

For Partition, apply the grouping rules in `resolved-indexer-instructions` to each
task's View. Context handles strategy selection and retries; do not look up a separate
strategy definition or submit strategy metadata. Report missing source material or
unresolvable semantic boundaries through the current Result schema.

Read `partition-authority` before choosing each group subject. A string
changes only the local key and preserves `base_subject_key` namespace and kind. Use an explicit
subject object only when its kind is listed in `subject_key_contract.kinds`; never invent a kind
from a page title, operation name, framework term, or business vocabulary.

`subject_intent` describes the reader-subject outcome, not the source file's role. Use `primary`
when the group owns a reader subject. Use `enrich-or-independent` for a publishable supplemental
view such as test or example behavior: Context reuses a matching subject when available and creates
an independent subject otherwise. Do not emit `supporting`; material that must never become a reader
subject must not be emitted as a group.

For an Author Result, write reader-facing `title`, `summary`, and `sections` only when publishing.
When the task lists multiple artifact intents, choose its displayed `artifact_intent` for the page you write.
Each section uses `source_items` to refer to supplied sources and, when useful, `facts` to refer
to supplied Fact items; both are arrays of references, not objects. Copy `source_items` from the
task's Source material, not inventory or repository identifiers. Context constructs the internal
Facts and EvidenceBindings. For `catalog-only`, return the member dispositions without dummy prose
or sections: Context retains the corresponding authorized facts. Do not use it when the View lacks
facts for that member; report unsupported or missing material instead.
For behavior, read the source excerpts in Source material. A signature or call name alone does
not establish behavior absent from those lines. Do not copy process-only carriers into reader Markdown.
If an explanation needs a dependency body that is not supplied, use `request-material` with
specific repository-relative file or directory paths in `material_gaps[].source_hints`.
Context expands available registered source bodies through the same completion command.
On `material-expanded`, read the returned task's added material and finish the preserved draft;
do not recollect, repartition, or repeat accepted peers. If a path is unavailable or already fully
supplied, use the stated reason to correct the request or describe the remaining gap, not retry unchanged.
Installed guidance can be newer than a resumed task. Context owns this compatibility decision;
follow the current Route without comparing Provider fingerprints or regenerating task identities.
Do not invent or manually copy read-receipt, execution-receipt, or stable-result digests. Submit
exactly `context.indexer.current-action-input/v2` through the Route's completion command; Context
derives internal envelopes and performs dependency, schema, owner, scope, and per-workset validation
before reporting each task accepted. Read the completion's `outcomes`, then continue directly from
its `next` Route and ready Resource paths. Do not run `context status` or either Resource materializer
between successful batches. A failed item is retried from its returned task-only skeleton; already
accepted peers are not repeated. Never report success merely because the envelope or prose looks valid.
