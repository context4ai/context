---
id: procedure.work-start-report
kind: procedure
mediaType: text/markdown
---

# Write a work-start report

After representative source reading and necessary reader-purpose/scope discussion,
and before semantic Partition, preserve useful decisions for substantial new work
in `.tmp/work-start-report.md` at the current workspace root. Use the companion
`template.work-start-report` Resource from this Route. This is an Agent-written
reader document, not a CLI-generated summary or an Indexer Artifact.

## When it helps

Write it for substantial new work expected to continue across deliveries, or
when the discussion establishes material scope, version, evidence or delivery
choices worth carrying into later work. Also write it when explicitly requested.
Lightweight single-document work, small edits and routine upgrades normally need
only a short conversational summary. Neither asking one question nor having more
than one delivery automatically makes a task substantial: the first batch is small.
Do not count files or estimate an exact page total just to decide whether to write.

Reuse explicit goals and settled choices; ask only about unresolved reader purpose,
material scope or core feasibility after reading available authorized material.
Use the existing discussion and approval routes, at most three questions per round.
Template headings, approximate counts and optional sections are not a questionnaire.
Source-read permission and named repositories/documents establish the material
boundary, not the reader's purpose, desired depth or treatment of older versions.
Do not turn your own proposed purpose into a confirmed user decision. Managed mode
delegates execution and eligible review, not unresolved intent. Ask concrete,
material questions and wait for answers before dependent planning; do not invent
questions when the user's request already settles them. Do not record a transcript
or repeat substantive questions already answered.

Recommend a reading organization, proposed article types and useful chapters in
the report, with reasons from actual material. Use the companion template's
organization options as starting points. Carry explicit feedback into formal
planning; navigation groups do not define source ownership or KB paths. Do not
turn writing suggestions or ordinary version differences into completion gates.

## Placement in the current flow

Save confirmed requirements through the existing registry configuration flow.
When selecting Providers, use their supplied capabilities to describe likely
content collections in the user's language. Write the report before proceeding
to semantic planning. If an existing workspace reaches Partition directly, reuse
still-applicable decisions and the report, or write one there when the current
task warrants it. Do not restart capture, Provider selection or accepted work.

Use the Host file-writing tool for this one scratch Markdown document. Keep it
outside `.tmp/context-runtime/`; do not write knowledge, candidates or runtime
state directly. This permission does not authorize other workspace writes.
On the first report for substantial new work, show its actual clickable path,
summarize the proposed scope, important choices and first delivery, and invite the
user to read and correct the plan before semantic Partition or bulk writing.
Pause the conversation for that response, including in managed mode. A generic
managed authorization does not waive this reading opportunity. If the user has
explicitly asked to continue without waiting for report feedback, honor that
instruction; still ask any unresolved core intent question. Silence or elapsed
time is not feedback. Reuse an earlier response on continuation; do not repeat
this pause per batch or for an unchanged report.
After feedback, update affected decisions and continue the same Route. This is a
conversational handoff, not a `complete-current` payload, approval receipt,
required-state flag or separate Graph Gate. Do not add CLI polling or a report
completion marker. Its existence never resolves a purpose or authority question.
If writing fails, describe the problem and give the summary in conversation;
provide the same reading opportunity in conversation; do not change workflow
state or manufacture a receipt to compensate.

## Keep it tied to the actual task

At the end, in one reference line, link the existing requirement or its workspace file and existing
requirement ID/name. When only a workspace reference exists, use it with the
stated purpose and scope; do not invent another ID. Resolve local links relative
to the report's location, not the installed template. Later Agents follow that
reference to check the current requirement, approval authority and actual settings.

Open with the reader's task and first useful pages, not requirement IDs or settings.
Use the user's language without announcing it; mention language only if a distinct
delivery-language requirement matters. After the opening, briefly explain the
practical consequences of the agreed execution mode and observed debug setting.
For example, managed execution means you review and deliver eligible batches
without asking the user to approve each one; the first-report reading invitation,
unresolved intent and non-delegable approvals still apply. Enabled debug records
diagnostic details to help investigate problems, not a promise of permanent logs.
Managed mode requires existing explicit authorization; the report cannot grant it.
Read debug status with `context debug status --format json` when needed; do not
enable it just because this is a test. If the workspace is not initialized yet,
say the setting has not been checked and check it later. These are observations,
not three new questions. Do not copy secrets or a whole configuration file.

Update the same report when purpose, scope, key choices or relevant settings
materially change. Reuse it on retries and continuation; do not write one per
batch, Author or source. Current requirements, Route and approvals remain the
execution authority. Report text is background, not source evidence for claims.

## Write for a person

Write the report, including headings and collection names, in the user's language.
Use the template as an outline with guidance, not text to copy into the output.
Aim for a short connected report, usually one or two pages, without cutting useful
decisions to meet a length target. Open with the real reader situation and the
first useful deliverable. Name the point at which it becomes readable; give a time
estimate only with a basis and conditions, not an invented deadline.

This fictional opening illustrates connected prose, not a reusable audience,
scenario, content plan or sentence pattern:

> People joining the project need instructions they can follow through their first
> task, with somewhere to turn when a step goes wrong. The first delivery brings
> that path and its essential reference pages together. Once reviewed and built,
> it can be used while the remaining topics are still being prepared.

Synthesize findings across sources in paragraphs, linking supporting material
where useful. Do not turn every inspected file into a row. Distinguish the user's
choices, still-valid prior decisions and your arrangements within that scope.
When missing core evidence led to a decision to deliver a known boundary or seek
additional sources, explain that decision and its authorization boundary in scope;
only the remaining local gap belongs at the end. Do not call omitted core work done.

In the scope discussion, explain which named regions warrant knowledge pages,
which only support those pages, and which are outside this task, with reasons
from representative reading. Include meaningful version or lifecycle findings,
not a mandatory deprecation section. State any relevant boundary not yet checked
and the concrete next inspection; do not imply unchecked content is unnecessary.
When excess scope is a real concern, explain its practical cost briefly: reading
and generating unneeded content uses tokens, slows delivery and can make useful
answers harder to find among duplicate or conflicting pages. Do not attach this
warning to every report or invent a cost percentage. Separate recommendations
from settled decisions; the report never authorizes exclusions or source deletion.
Resolve substantive scope questions before dependent work using the existing
conversation, not a new form, threshold, score or approval state.

Use tables for content groups, Indexer choices and remaining gaps when useful.
Keep the requested Indexer comparison near the end, before remaining gaps. One
content group or a simple gap may be prose; omit empty tables. Do not
leave placeholders or template instructions. Mention only one to three actual
pitfalls for this task, not a generic risk register, compliance checklist, scoring
rubric or repeated acceptance Gate. Avoid repetitive labels, ceremonial readiness
claims and unsupported promises of completeness or efficiency.

## Explain the Indexer choices near the end

Explain "Indexer" once as a skill for turning source material into useful
knowledge, then use readable skill names. Build the table from the current Action's
CLI-bundled catalog and relevant Indexer Skills already visible to the Host, not
from a hard-coded community/company list or a scan of every installed skill.
List each currently discovered candidate, including those not selected. State the
observed catalog's scope; do not imply it includes undiscovered providers. Use
compact capabilities for unselected candidates; do not open all their guides just
to populate the report. If discovery is not yet available, say so and update this
section during the existing Provider selection step.

For each row, explain its function, this work's choice, affected named modules or
texts, expected knowledge coverage and the reason. Ground the estimate in the
purpose, source overview and representative reading. An optional skill might add
context to another skill's output without owning another set of pages; explain
that relationship rather than predicting duplicate articles. Non-selection must
say what is unnecessary, already covered, outside scope or unavailable, and whether
it leaves a meaningful gap. Do not invent reasons, unsupported capabilities or
numerical estimates. Missing required coverage follows the existing resolution
flow, not a casual "not selected" row.

Before the selection is applied, label it as proposed. Read current configuration
and any resolution status before saying a skill is enabled or usable; a catalog
entry alone does not prove either. Update the same report when selection settles
or changes materially, preserving prior discussion instead of asking per row.
Explain expected changes to knowledge coverage, not modifications to source code
or documents and not work already completed. This table is an explanation of the
existing selection, never an installation request, a new Result field or authority
to bypass Provider selection. Follow the first-report reading handoff above.

## Use reader language, not internal workflow vocabulary

Translate internal terms into what actually happened or what the reader can use.
These are writing examples, not a runtime word blacklist; retain a technical term
when it is part of the reader's subject rather than Context's machinery.

| Internal wording | Reader-facing meaning |
| --- | --- |
| body projection | downloaded document text |
| inline evidence / evidence chain | material actually read / source references |
| contract / contract table | API definitions / parameter and type table |
| resources | the actual images or attachments |
| semantic planning / Partition / grouping | the concrete next work, such as identifying topics to write about |
| readable delivery batch | pages delivered in batches that can each be opened and read |
| registered sources | the named materials included in this work |
| collection / document kind | the page form the reader will see |
| traceable navigation | links retained without reading their targets |
| pinned commit | the code version selected for this work |

One piece of information gets one column. Describe scenarios and reader tasks
alongside page forms; fold supported content categories into those forms rather
than duplicating them in a classification column. Do not invent unsupported page
types or make the user select internal template IDs.

Where scale is discussed, give a number, a range, or a specific explanation of what
must be done before estimating. For example, identifying the public entries still
to cover is concrete; "determined after semantic planning" says nothing useful.
Use observations already available, state the currently known scope, and name a
real opportunity to refine the estimate. Do not pretend a count happened or add
an exhaustive scan solely for the report. Planning estimates are not page quotas.

Each pitfall should identify concrete objects and the consequence of confusing
them, not just say "do not conflate". Prefer active verbs and plain sentences;
when several abstract nouns stack up, rewrite around who does what. Read the draft
once for jargon, duplicate columns and evasive scale descriptions. This is an
editorial pass, not a score, automated term counter or another approval Gate.

Simplifying language must preserve meaning. A code declaration is not proof of
runtime behavior; a FAQ may describe conventions or conditions absent from code.
Explain meaningful conflicts instead of declaring one source universally supreme.
Do not rewrite "not yet checked" as "unknown" or a tentative finding as verified.
Adapt the report to the actual sources and purpose; keep business examples out of
the reusable template, and do not copy this guidance into the finished report.

The scratch path is outside current runtime cleanup targets, but `.tmp` is not
permanent storage. Respect workspace ignore rules; do not publish or commit it.

For Note/Sessions input, report the actual reader outcome (an existing-page
correction, an independent FAQ/guide/decision, or saving only). Describe a chosen
business replacement and why the default is not selected. Do not infer enabled
skills from the shipped catalog. When combining Providers, explain which one
writes the page and which supplies context; avoid exposing layer/profile jargon
in the report. A session may have no code association.

## Progress in reports and conversation

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
