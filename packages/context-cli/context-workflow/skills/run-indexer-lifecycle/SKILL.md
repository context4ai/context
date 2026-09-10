---
name: context-run-indexer-lifecycle
description: Continue the sole Context registry-and-Provider indexing route; use only when the workspace Graph selects route.indexer.lifecycle-required.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: workspace
  agent-graph.entry: context
---

# Run The Indexer Lifecycle

This Action continues the sole registry-and-Provider indexing route. Use the
current Indexer subroute for semantic partitioning, structure review, authoring,
composition, layout, Candidate compilation, and repair. Existing approved
knowledge is an input to incremental planning, never a parallel authoring path.

Read
the `context.indexer.provider-guide` resource at the exact path in the current Route,
then follow the root `context` Skill's Indexer instructions and the exact
structured outcomes returned by `context indexer ...`. Start by forming and
confirming requirements when `src/indexers.yaml` is absent or stale. When the
Route returns `configuration`, edit the named project file and re-evaluate;
do not submit a lifecycle Result or repeatedly run an unconfigured project. Otherwise
continue the current registry selection, Provider resolution, execution,
reconciliation, mechanical validation, layout, and Candidate compile subroute. The Indexer
Graph is the authority for each substep. Never skip directly to compile and
never synthesize a Provider Result or a default plan.

A large `complete-current` reply may use `context.action.completion-summary/v1`.
Read its `result_file` for complete task diagnostics and `next_route.file` for the
exact next Route. Counts and shortened messages are only a summary; never resubmit
committed tasks to obtain missing output. If `next_preparation` failed, use its
recovery command; committed tasks remain saved. For a long submission use a UTF-8
JSON/YAML file in `.tmp/` with `--input <file>` rather than feeding a long line into
an interactive PTY. Keep the Route revision and completion command unchanged.

After the registered source overview and representative reading, resolve only
missing reader purpose and substantive scope before planning. Reuse the user's
explicit request and existing goals; a missing `purpose` alone is not a reason
to ask. Source-read authorization does not settle purpose, depth or version scope.
Fully managed execution does not authorize choosing an unclear purpose. Ask and
wait when these choices remain unresolved, without re-asking explicit decisions.
Ask at most three questions in one round, without filling unused slots: combine
reader and task into one question, then clarify substantive scope, then only a
real tradeoff. Use the current conversation language and a shared human/Agent
knowledge package by default; do not ask about reading audience or language.
Recommend organization and templates, and test that recommendation with the
first small delivery instead of asking abstract classification questions.
Save the short conclusion as `purpose` in the existing requirement, with scopes
and exclusions in their existing fields. When an agreed exclusion maps to exact
repository files or directories, set `exclusions[].paths` to those repository-relative
paths and retain its `scope` and `reason`. No wildcards are accepted. Context filters
these before Parser/Partition work; an omitted `paths` means the whole stated scope.
Do not translate a vague age or naming clue into an exclusion. A shared Indexer
retains files still needed by another applicable requirement. Confirm the scope
before bulk work: unnecessary inputs consume tokens and slow useful delivery. Do not store a questionnaire or add
another confirmation after an explicit answer. Silence is not approval.
During the authorized source overview and representative reading, actively assess
which regions serve the reader's task, which only support it, and which appear
unnecessary. Check available entrypoints, maintained guidance and lifecycle or
version notices; deprecation is one possible scope concern, not the sole trigger.
Names, age, file counts and generated status are clues, not exclusion rules.
Propose concrete boundaries with reasons. Explain a material tradeoff once:
including large irrelevant regions increases token use and processing time and
can dilute useful knowledge with repetitive or conflicting pages. Do not claim
measured savings or reduce requested coverage merely to make the run faster.
Resolve meaningful unanswered scope choices with the user before dependent bulk
work, including in managed mode, unless the user explicitly delegated that scope
choice. General managed/no-review permission alone is not that delegation. Reuse
an applicable inclusion/exclusion decision in later structure previews; do not
turn the same decision into another human gate. Ask only about material new
findings and describe the wait as a scope question, not a CLI failure. Carry out settled choices within existing
authorization without asking per file. Use available counts with their unit and
coverage, not an exhaustive scan just to obtain a number. If the relevant boundary
is not yet checked, say what remains to inspect rather than declaring it absent.
Preserve decisions in existing requirements and the report when applicable.
Revisit only material new findings on continuation; do not restart accepted work
or delete existing knowledge to implement a proposed scope reduction.
Read authorized captured sources before raising material gaps; only unresolved
core questions requiring new sources or human knowledge need another question.

After those decisions, use the Route's `procedure.work-start-report` and
`template.work-start-report` Resources for substantial new work or material
choices worth preserving. Write the readable report at `.tmp/work-start-report.md`
before semantic planning, using the existing requirement reference and actual
settings. Lightweight work keeps a short conversational summary. This is a scratch
document written with the Host file tool, not another Gate or Action payload;
follow the procedure's first-report reading invitation and conversational pause,
including in managed mode unless the user explicitly waived that pause. Then
continue the same Route; do not add a report approval state or polling loop.
Reuse it on continuation rather than generating a report for every batch.

When the current subroute is a Gate, follow `gate.resolution_action` rather
than looking for a top-level `action`. Read its Skill and output schema, use its
Route input, and submit the resulting value through the Route completion
command. The Indexer Graph owns the Gate identity, authority, delegation and
resolution Action; do not replace them with an inferred command or handler.

Stop on the first Host permission, non-delegatable Gate, validation failure, or
human decision. Once current Candidates have been compiled, return control to
`context status --format json`; the workspace Graph will select Knowledge
Review. This outer Action has no payload of its own and must never be submitted
through `complete-current`. Context projects it to the one current Indexer
subroute; follow that Route's command and output schema exactly. If project
configuration was edited, re-run `context status --format json` to obtain the
new revision instead of inventing a lifecycle continuation result.

## Readable delivery batches

Planning can pause at a settled ready-theme wave while unfinished Partition
entries remain saved. After the wave's structure/content Review, close and build,
resume the fresh Route back to planning. Never call the workspace complete from
one wave's Author or build count. The `planning` progress block includes the
suspended remainder. Later material may improve an already delivered subject;
retain its identity and approved prose instead of treating it as a new page.


Follow the current Context Route through Review, close, and build as soon as a
page delivery is ready. Automatic theme waves grow as 3, 7, 10, 20, 30, 30,
then 50. A fully planned scope with fewer than 10 themes stays together. A final
remainder may be smaller. Each wave completes Review/close/build before the
next; repairs or build failures hold the next wave at the current step.
Theme targets are not guaranteed output-page counts. For an explicit user
preference, `context run --delivery-size 20 --format json` sets future waves
for this task; `--delivery-size auto` restores automatic sizing. Existing active
waves remain intact. Fixed sizes accept 1–50.
Count pages, not Author calls or worksets. An accepted multi-page Result can
span deliveries without resubmission. A successful package build is a delivery
checkpoint, not evidence that every Author task is complete: evaluate the Route
again and continue pending work. Never manually clear accepted runtime state.

If the user explicitly asks to inspect the current work earlier, run
`context run --deliver --format json`, then follow its current Route. This asks
for an earlier checkpoint; it does not authorize content or bypass Review.
The Author Route exposes this user-requested alternative under `delivery`,
including accepted pages waiting and the actual waiting condition. It is not an
automatic command to run on every batch. If Author work is already running,
finish that current batch; the next lifecycle advance selects complete accepted
pages before starting another batch. Follow any required Composer, Review,
close and build steps, then resume the remaining Author work with its new Route.
`delivery_boundary: false` only means no explicit reader-task boundary; it does
not disable the automatic delivery-wave checkpoint. Never predict all tasks must
finish from that flag. A user asking when pages will appear needs this
explanation; asking to see them now authorizes the early-delivery request.
Ordinary mode retains the current batch's approval Gate. Existing managed
approval covers delegatable batch Gates without another mode questionnaire.
A failed build retains the same current pages; fix the reported build problem
and rerun the returned command before authoring another batch.

At workflow completion, return to the Context entry and reconcile the user's
remaining requests with delivered pages and registered maintenance targets.
Composer tasks are derivation checks, not a list of queued page revisions.
Empty proposals may finish an already delivered scope without another Review or
build. Continue authorized, unregistered revisions through the normal entry;
do not resubmit accepted Composer tasks or treat an empty queue as proof that
every conversational request was completed.

## Continue the current handoff

An `agent-required` handoff asks you to do the next task in this authorized
conversation. Read the current Route, perform its task and follow its returned
`next_route.file`; do not end after a successful small batch just because the
CLI returned. Stop for a real missing decision, external blocker, completion or
a Host limit, and state the exact continuation point. Reuse material whose
content digest and source scope are unchanged and which is still available in
your context; a new Route revision alone does not require reading it all again.

`batch_budget` describes a transport batch, not a delivery or approval boundary.
For Partition its input-byte scope excludes optional detail files and independent
source exploration. It is not an actual token bill or the total eventual reading
cost. Read linked details where the compact overview cannot resolve the task.
The input bytes include shared instructions and deduplicated material; they are
not tokens. A task cap, input/output budget, View budget or Provider boundary can
limit the batch without indicating an error. Keep every task's authorized input
and outcome complete.

For generated APIs, `table-complete` permits omitting a declaration already
expressed by the table, `component-wrapper` omits only the redundant wrapper,
and `not-provided` means these facts contain no separate declaration. None
proves that a page meets its purpose. Verify the actual changed rows and sources;
resolve an explicit request for a complete declaration with the user instead
of repeatedly repairing identical inputs or silently changing that request.

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
