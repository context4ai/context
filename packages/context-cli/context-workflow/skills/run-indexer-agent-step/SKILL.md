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
For `stage: approved-revision`, follow `procedure.approved-revision`: read the
supplied approved page and return the revised Markdown using that action's schema.
The batch instructions below apply to Partition, Author, and Composer worksets.

Use the readable `resolved-indexer-instructions` and each task's
`authorized-indexer-workset-view/task-NNN`, including its goals, constraints and source material.
Each task has its own reading file. Read its referenced shared files once;
relative links resolve beside that task file. Shared resources are also listed
in the Route. A shared file does not authorize another task to use its references.
Match each result to its task's own goals, source material and allowed references.
If the file tool truncates its output, continue with the unread part of that same file;
do not mistake tool truncation for missing source material or restart the Context task.
Match Views and outputs only through
the short `task_key`; do not copy internal digests into the semantic result. The reading contains the
recommended source material, supplementary facts, Provider fragments, and authority for each task. Do not
construct evidence read requests, manage pages or cursors, discover another Skill, read a
Provider path, widen source scope, run an unauthorized Indexer or parser, or invent missing
evidence.

Return exactly one `results[]` entry for every task in the current batch, in task-key order. Each
entry carries its `task_key` and the existing stage-specific semantic Result. A single-task batch
still uses the same array shape. Prepare distinct results together and submit the batch once;
do not turn it into a separate CLI round trip for each page. Copy dynamic authority values only from the Route input or that
task's authorized View.

At the start of Partition, preserve the settled purpose/scope decisions in the
work-start report when this substantial task warrants one and the earlier setup
did not already cover it. The current Route exposes `procedure.work-start-report`
and `template.work-start-report` for that handoff, including the scratch write
boundary. Reuse an applicable report on continuation; do not recreate it for each
workset. Report text is context, not evidence or authority. Author follows the
accepted page plan and does not reread these resources or rewrite the report
unless a material task decision changes.

For Partition, apply the grouping rules in `resolved-indexer-instructions` to each
task's View. Check its material against the settled reader purpose and scope;
inventory membership is not a requirement to publish a page. A newly discovered
region with materially different relevance, version or lifecycle may require a
scope discussion before dependent output, even in managed mode. Explain the
specific impact and preserve accepted work; refresh the Route after an authorized
configuration change. Do not silently exclude unresolved work or replay all tasks.
Context handles strategy selection and retries; do not look up a separate
strategy definition or submit strategy metadata. Report missing source material or
unresolvable semantic boundaries through the current Result schema.

Read `partition-authority` before choosing each group subject. A string
changes only the local key and preserves `base_subject_key` namespace and kind. Use an explicit
subject object only when its kind is listed in `subject_key_contract.kinds`; never invent a kind
from a page title, operation name, framework term, or business vocabulary.
For a new reader subject, choose a durable, readable namespace and local key:
the main page defaults to `knowledge/<collection>/<namespace>/<local-key>.md`
(normalized as readable slugs). `group.key` identifies a group and `title` labels
its content; neither renames that path. A capture token such as `wiki-a1b2c3d4`
is not a reader namespace. Use the existing explicit subject object to choose,
for example, `namespace: sample-web`, `local_key: faq`, with the permitted kind.
Avoid repeating the same name as both directory and basename. Preserve an
existing subject when enriching it; changing a title is not a reason to change
identity. Context preserves approved paths and routes collisions to the existing
layout confirmation, where readable renames are chosen instead of hash suffixes.

`subject_intent` describes the reader-subject outcome, not the source file's role. Use `primary`
when the group owns a reader subject. Use `enrich-or-independent` for a publishable supplemental
view such as test or example behavior: Context reuses a matching subject when available and creates
an independent subject otherwise. Do not emit `supporting`; material that must never become a reader
subject must not be emitted as a group.

For an Author Result, write reader-facing `title`, `summary`, and `sections` only when publishing.
When the task lists multiple artifact intents, choose its displayed `artifact_intent` for the page you write.
Each section uses `source_items` to refer to supplied sources and, when useful, `facts` to refer
to supplied Fact items; both are arrays of references, not objects. Copy `source_items` from the
task's Source material, or use repository-relative file paths for captured code you read directly,
not inventory or repository identifiers. Context constructs the internal
Facts and EvidenceBindings. For `catalog-only`, return the member dispositions without dummy prose
or sections: Context retains the corresponding authorized facts. Do not use it when the View lacks
facts for that member; report unsupported or missing material instead.
For behavior, read source text. Source material is a focused default, not an exclusive reading boundary.
The task's `source-access` lists captured file paths under `captured_root`; use your file tool to read
these files directly when excerpts are insufficient. Do not switch to a live checkout or unrelated
sources. Submit the read files' repository-relative paths in `sections[].source_items`; Context
resolves the source association without manual fingerprints or a separate CLI call.
A signature or call name alone does
not establish behavior absent from those lines. Do not copy process-only carriers into reader Markdown.
Read shared instructions once while they remain available in the current conversation;
unchanged instructions do not need rereading for each task. Read every task's own material.
If an explanation needs a dependency body, first read its captured file directly. Only when
the supplied source access cannot provide the body, use `request-material` with
specific repository-relative file or directory paths in `material_gaps[].source_hints`.
Context expands available registered source bodies through the same completion command.
On `material-expanded`, read the returned task's added material and finish the preserved draft;
do not recollect, repartition, or repeat accepted peers. Re-requesting supplied files is safe and
returns usable material again. If a path is unavailable, correct it or describe the remaining gap.
Installed guidance can be newer than a resumed task. Context owns this compatibility decision;
follow the current Route without comparing Provider fingerprints or regenerating task identities.
Do not invent or manually copy read-receipt, execution-receipt, or stable-result digests. Submit
exactly `context.indexer.current-action-input/v2` through the Route's completion command; Context
derives internal envelopes and performs dependency, schema, owner, scope, and per-workset validation
before reporting each task accepted. Read the completion's `outcomes` and `next_route.file` (the exact next Route), then continue directly from
its `next` Route and ready Resource paths. Do not run `context status` or either Resource materializer
between successful batches. A failed item is retried from its returned task-only skeleton; already
accepted peers are not repeated. Never report success merely because the envelope or prose looks valid.
If `next` is null and `next_preparation` reports failure, the committed outcomes
are still saved: run its recovery command, not the previous submission. A stage's
`progress.stop=complete` does not mean Review, close or package build is finished.

## Reader purpose and saved page plans

Use the bound requirement's `purpose` and open `reader_goals` throughout planning,
authoring and review. During Partition, select `artifact_intent` and `template_id`
from the current partition authority, retain `reader_task` and `outline`, and use
`priority` (lower first) and `delivery_boundary` to identify a complete reader task.
Choose a first representative module of roughly one to three pages. Do not group
unrelated types because they share a file, or treat every export as a page.
Author uses the saved choice; do not change it on retries or Provider refresh.
Integration and maintenance purposes may share contracts without duplicating prose.
Identify actual module roles from registrations and consumption: a client is not
a server, a runtime is not a module role, and an application component is not
a published component library. Preserve behavior needed for the reader's task.

For `stage: source-update`, follow the selected source-update procedure and action schema. Read current approved pages and the fixed source changes before deciding which pages need revision, including any new topics absent from existing page references.
