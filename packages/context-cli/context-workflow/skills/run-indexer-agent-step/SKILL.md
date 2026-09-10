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

During Partition, read the whole inventory overview and each member's identity,
not every implementation body. `partition-navigation` shows the surrounding scope;
`consumer-anchor overview` links to complete immutable fact details. Open those
files and the bounded `source-access` paths whenever ownership, lifecycle, a
shared dependency or the reader task is unclear. Sampling helps orient you but
cannot justify excluding uninspected members or asserting behavior. Unknown
material formats remain full required reading. Author can access complete selected
facts and source text; reduced planning input is not evidence for a final claim.

Set a group's `ready_for_author: true` only after its identity, primary ownership,
reader task and relevant shared dependencies are resolved well enough to write
an independently useful page. A sample, file boundary or large fact count is
not sufficient. Leave it absent/false when neighboring material could change the
boundary. This declaration permits an early wave; it does not mark the remaining
inventory complete or bypass normal structure/content review. After a wave's
build, follow the fresh Route back to remaining Partition tasks. Later material
for the same subject must retain its identity and improve its approved pages,
not create duplicates. All inventory members still need final dispositions.

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
Read the main task and its shared material, then expand details for the claims and
member decisions you need to make; do not open every optional file as a checklist.
Style-name rows locate captured CSS, not public interfaces or runtime behavior.
Rows use the supplied column names; row numbers are never source or member IDs.
All inventory IDs remain explicit. Supporting style rows without a ref can be
traced through the source or full parser detail when a fact citation is needed.
A stylesheet path or inventory ID is not a requirement to read the whole file.
Use the accepted plan and supplied evidence for supporting/catalog decisions;
open the relevant rules only when a planned claim or unresolved member decision
needs layout/state/theme/override/accessibility detail. Do not add visual prose
merely to cover style records, or infer exclusions from selector names alone.
Package briefs support the fields explicitly shown. Open the full manifest only
when a needed import condition, dependency or build detail is missing. Do not
reread either source solely because it appears in navigation.
`members_from` reuses an identical Props member list within the same source file;
combine it with the component's own parameters/defaults and retain any uncertainty.
Inherit `page_plan.artifact_intent`; omitting `artifact_intent` also uses the saved plan.
Use `primary_artifact_options` when selecting a policy; derived-page intents are not additional pages to write.
For mechanical assembly, copy the current Route's recommended `indexer-author-scaffold`
JSON resource to workspace `.tmp/agent-payloads/`; do not edit the runtime resource.
It already contains the current task keys, planned intent, unambiguous policy and member IDs.
Write the prose, references and member decisions. Use a fresh scaffold when the Route's
revision or task set changes; never reuse accepted tasks from an earlier batch.
`context action scaffold-current --revision <current-revision>` remains available to
explicitly recreate the skeleton, but is not an additional required command.
Empty states are intentional:
the scaffold never chooses coverage or a publishing decision on your behalf.
Members with the same state, section and reason can share one disposition entry:
`{items: [<member-id>, ...], state: covered, section: <section-key>}`.
Do not also list these members individually. Context expands the groups and performs
the same per-member ownership and coverage validation.
For uncertain submissions, add `--preview` to the current Author completion command.
It validates and renders the current result without accepting tasks or advancing the Route;
this is optional, not another required round trip. Read failures, repair the payload,
then submit normally. Preview input errors include `issues` with paths relative to
each task entry (starting at `result`) and section/member identifiers when available.
Use those paths to locate edits; errors from conversion or rendering keep their
original message and do not imply a payload field location. Preview does not replace Review or guarantee a later unchanged revision.
Each section references supplied source material through `source_items`, `facts`, or both.
Both are arrays of references, not objects. Authorized Facts already carry their source
bindings, so do not repeat those bindings in `source_items` merely to satisfy a field.
A section with neither resolvable sources nor Facts is still invalid.
Catalog-only and unsupported results publish no Artifact and need no policy selection. Copy `source_items` from the
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
unchanged instructions do not need rereading for each task. Read every task's own goals and member overview. Large captured files may be linked
rather than inlined: read the relevant implementations and dependencies by range;
if scope or behavior is unclear, expand the whole file. Navigation, CSS selectors
and AST signatures do not establish behavior by themselves. Full parser detail
files are optional unless needed to resolve a relationship or ambiguity. Known
carrier metadata may be omitted from the overview; all submission references and
canonical facts remain available. Never treat absent overview text as absent capability.
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
the stage-specific input described by the current Action schema through the Route's completion command; Context
derives internal envelopes and performs dependency, schema, owner, scope, and per-workset validation
before reporting each task accepted. Read the completion's `outcomes` and
`next_route.file` (the exact next Route). Read `result_file` when `details_required`
is true, output was truncated or the outcome is unclear; an ordinary successful
summary does not require rereading the full result, which embeds the same Route.
Continue directly from that Route and ready Resource paths. Do not run `context status` or either Resource materializer
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

## Semantic judgment and narrowed scope

Scripts may assemble references, serialize an Agent-authored result and submit it.
Do not use the first path to name an entire mixed group, classify all inventory
members as one topic, or generate identical API prose and unconditional publish
results. Reading a View with a script is not a substitute for understanding its
sources. Reuse mechanics, not unsupported content claims.

When the selected template supplies a program-generated API table, bind the
applicable facts and let the renderer produce field rows, types and defaults.
Do not write a second equivalent table or restate every row in prose. Explain
usage decisions, composition, pitfalls and migration boundaries; mention a
parameter or default when it helps explain that behavior. This does not waive
source reading or member coverage. If a generated value conflicts with source,
identify the field and source location through the current repair flow; do not
patch the generated block or add a competing answer in prose. Without a suitable
program block, follow the selected template and write the source-backed explanation
needed by the reader rather than omitting it.

Keep each parameter and default attached to its own callable or type. Missing
extracted members do not establish that an API has no parameters or callbacks;
read the referenced source when inherited types or static methods matter to the
reader. Before extending a first batch, check that its pages answer the promised
reader tasks, including document-grounded integration or troubleshooting where
required, rather than only listing exports.

For Composer, inspect the selected task's primary page and remaining material
before choosing an empty proposal list. A script must not decide that every
Composer is unnecessary. Existing API tables may remove duplicate table work
without answering the task's examples or usage questions.

Use one production driver for this workspace. If a submission process is still
running, await its completion instead of starting another lifecycle driver from
an observed status. A local content repair or truncated read is not a reason to
run `task prepare --apply`: that command ends the old task. When scope decisions
change, update the existing applicable requirement/report without extending a
one-task exclusion into a permanent policy.

When `page_plan.scope_change` is present, reassess the residual group before
Author: the previous title, reader task and outline describe the original scope.
Excluded members remain excluded. Publish only when the remaining sources support
a useful page, with an accurate title, summary and an allowed artifact intent.
The old template/intent restriction has been released for this changed group.
If it should not be a page, use a supported non-publishing outcome and truthful
member dispositions; catalog-only requires authorized facts. Zero extracted facts
alone does not prohibit a source-grounded document, and does not establish an API.
Do not restart unrelated accepted tasks to repair this group's interpretation.

## User-facing progress

Use CLI `progress.scopes` (or `indexerProgress.scopes` in status) as the
single source for progress in conversation and reports. It separates:
- `overall`: delivered pages and cumulative planning for the current Indexer run;
- `wave`: writing tasks, observed pages and composition for the current wave;
- `slice`: tasks in the currently active Route slice.

Planning completed counts currently valid accepted tasks, not lifetime effort.
When overall.planning.needs_recheck is nonzero, report “规划当前有效 X/Y 项；Z 项因任务绑定变化待复核”.
Do not describe a lower valid count as lost pages or silently restarting from zero.
The CLI reason identifies binding changes, not proof that source code changed;
do not invent a more specific cause.

Keep these scopes separate. A wave or pause target never replaces the overall
scope. Preserve overall planning across Author, Composer and Review transitions.
Use each counter's `unit`: task means 项/任务, page means 页. A writing task is
not automatically one page. A null total means 总数待确定, not zero or the
number of currently prepared tasks. Revisions can overlap delivered pages;
do not add wave tasks to delivered pages to invent a page total.

Use two bold progress lines. The first combines `overall` and a clearly labelled
`wave` supplement; the second uses `slice`. For example, with matching CLI values:
**[总体进度：已交付 33 页，总页数待确定；规划完成 50/122 项；本轮写作完成 30/30 项]**
**[当前分片：补充内容检查 0/8 项]**

A completion receipt's `submitted_slice` describes the slice just submitted;
`progress.scopes.slice` can already describe the next Route. Use the former when
reporting submission success and the latter when announcing the next slice.
Never combine their numerators and denominators. A null slice means no active
Agent task slice, not that the workflow is complete. During Review/build, state
the returned Route action briefly rather than inventing a slice ratio.
If progress is unavailable after task cleanup, say the counters are unavailable;
do not turn the last wave into the overall scope or report delivery as zero.
Continue authorized work after an update; only the agreed delivery stop or an
actual unresolved blocker permits stopping. This format governs progress, not
answers, review findings or necessary questions.

### Planned articles

When the current Partition authority supports an article plan, keep one subject
and one inventory owner for the topic. Plan stable article keys, the reader task,
allowed intent and template, required or optional articles and sections, and one
required article responsible for each primary question target. A shared source
member may support several articles without being owned several times.

For an accepted `page_plan.articles`, submit per-article content using those keys
and the current Author question identifiers. Keep the group member dispositions
unique; a covered member identifies its article and section. Follow the current
schema and returned diagnostics when a required article or its evidence is
missing. Change the accepted plan through the existing structure adjustment
route before adding articles or changing their purpose. Legacy single-page
plans continue to use the single-page submission.

For a selected page program, use the current variable catalog and its linked
article guidance. A semantic `template_variables` value may bind its own
`value`, `source_items` and `facts`; use current reading-view aliases. This lets
you supply a supported chapter without writing another copy merely to attach
evidence. Plain strings retain the existing section-evidence binding behavior.
Do not populate deterministic variables with prose: the runtime projects them
from authorized facts. Select a registered reader goal compatible with the
article intent; the program cannot change an accepted article's purpose.

Choose the article form before filling variables. For L03, a system overview
uses scope, packages, foundations, components, configuration, adoption and
references; a foundation topic uses purpose, catalog, mapping, consumption,
rules, platforms and references; runtime adoption uses environment, globals,
inheritance, resources, ssr, platforms and verification. These are alternatives,
not a request to fill all slots or produce a page for every token. Use only forms
supported by the selected source and reader task.
For F11, a directory emphasizes scope, catalog, contracts and details; a child
application detail emphasizes ownership, integration, capabilities, navigation
and delivery. Link common host contracts rather than repeat them in each detail.
Read each selected article's guidance for chapter responsibilities and examples.
If a supported chapter does not fit an available variable, submit it in that
article's `sections` with source evidence; do not put it in an unknown variable,
which is warned about and ignored. Preserve accepted section identities where
applicable. Empty scaffolds are input skeletons, never finished reader content.

Treat article outlines, writing slots and size recommendations as guidance.
Keep useful evidence-backed content when a slot is unavailable; assess whether
to merge, omit or add a chapter. A template or source version difference alone
does not require approval or a restart: retain the versions, explain relevant
uncertainty and continue work that the evidence supports. Agent review decides
relevance, completeness and compatibility; the CLI checks reference identity,
authorized scope, parseable inputs and concurrent revisions. A missing promised
article remains unfinished until delivered or the accepted plan is adjusted.

When supplied source text contains relevant usage examples, Author may declare
`example_candidates` with a stable `scenario_key` and the authorized
`source_item` path or reference. Select examples by reading their contents;
file names alone are insufficient. The runtime binds the selection to the
current subject, full path, source version and evidence, then exposes it to a
selected examples Composer. Distinct files with the same basename remain
distinct. Do not invent example source items, runtime outcomes or missing demos;
omit the optional collection when no example is applicable.

### Useful article content

Choose one primary location for each explanation. An overview states actual
capabilities and links to specialist articles; do not fill it with a promise
that another page has the information. Keep summaries short plain text, not
source tables. Merge a small overview and source-entry task when they would
repeat the same file list and reading instructions. Source-entry articles
should explain why each entry matters and name the next inspection action.

For C02 feature details use prerequisites, operations, exceptions, acceptance
and version when supported. For D04 engineering guides use scope, commands,
delivery and conventions; operational diagnostics remain separate.
For Q01 prefer systems/navigation/development/tools for a testing-domain map.
Q02 lasting strategy uses layers/coverage/collaboration; a change plan uses
risks/scenarios/environment/execution. Q04 regression selection uses
smoke/selection/prerequisites/records; results/failures/conclusion describe
actual recorded runs, never substitute for the selection baseline. Q07
confirmed incident reviews use triggers/cause/repair/prevention; unresolved
FAQ answers may omit these and retain investigation/followup.

When planning an entry article, mark the source-supported entry and next-step
sections as suggested required sections in the accepted article outline.
Existing outline-gap diagnostics are advisory; explain missing material or
add the supported content, without treating prose warnings as a new gate.
Template section question_refs label writing responsibilities; actual reader
coverage and its single primary carrier come from accepted question_targets.
Do not count template section labels as additional answered user questions.

For a deterministic API table, select the authorized contracts relevant to
that article's task. A page task needs its page inputs and consumed contract
entries, not every exported constant in the module. Keep caller/route context
in source-backed prose; a declared API does not prove a live call.

### Diagrams in reader articles

Use the selected Provider diagram instructions and the article guidance to choose a diagram only when useful. Put fenced Mermaid in an evidence-backed semantic section; use text trees for hierarchy and tables for exact contracts. Explain the diagram in prose and retain source/next-step coordinates for consumers without rendering. Diagram syntax or missing optional graphics never establish a new completion gate. During review, check the meaning and provenance of arrows, not the diagram count.

### Existing visual sources

For Author/Review involving source images or tables, consume the selected Provider `references/visual-source-processing.md`. Read current workspace AGENTS.md and `context.convertVisuals`; explicit user instructions override defaults. Use authorized `visual_resources` and sections[].visuals; reuse accepted unchanged results. Capability absence or unsuitable content retains originals without a new gate. Never edit source snapshots or delete assets yourself.
