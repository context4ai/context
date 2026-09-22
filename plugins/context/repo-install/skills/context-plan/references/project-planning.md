# Project research and staged delivery

## Project boundary and research materials

Work in the knowledge project selected by the user. Find its Git root and reuse
the existing workspace; a matching PLAN may be outside a nested Context working
directory. If the target project is not established, resolve that choice before
writing its plan. Do not create another repository merely to hold research.

Use this local layout when new scratch material is needed:

```text
<project-git-root>/
  PLAN-YYYYMMDD-slug.md
  .tmp/context-plans/YYYYMMDD-slug/
    repos/
    documents/
    research/
    stage-inputs/
```

Reuse authorized local checkouts in their existing locations first. For a source
requiring a new checkout, place it in `repos/`. Keep retrieved document bodies
and resources in `documents/`, inventory and investigation notes in `research/`,
and the current production handoff in `stage-inputs/`. These paths are conventions;
no file names or directory layout become a new command gate. Keep scratch data
out of Git and never force-add ignored files. The committed PLAN must retain
source identities and enough context to resume if local scratch files disappear.

Begin with directory metadata, source type, available versions and existing
knowledge coverage. Read representative bodies and relevant code entrypoints
to estimate scope and dependencies. Expand only where needed to identify useful
stages; a project inventory need not download every body before planning.
Save listing progress and failed branches, deduplicate sources by their actual
identity, and retry affected subsets using supported tools. Reading a directory
does not establish that its contents or outgoing links have been read.

Maintain the selected identity for each source and its embedded resources.
Record inaccessible items and their effect on the proposed scope. Do not prompt
for user authorization or switch a resource to a different identity simply
because one attachment failed. Reuse permitted representations when available;
otherwise record the reference and unavailable status. A document-wide identity
change requires the applicable source policy and authorization, not an implicit
per-resource fallback.

## Confirm unexpectedly broad document scope early

Count distinct source documents after identity deduplication, not aliases, images,
or output articles. Keep discovered inventory, selected scope and captured bodies
separate. Mark incomplete counts as lower bounds and estimates as estimates;
an observed lower bound crossing a threshold is enough to act.

- **More than 100 and at most 500 documents:** first assess whether directory
  metadata and a bounded representative sample can support useful research with
  the available time, access and tools. Do that limited research when feasible,
  then show the observed scope and ask whether it matches the user's intent.
  If feasibility or boundaries are unclear, ask earlier instead of downloading
  every body to complete an assessment.
- **More than 500 documents in this task’s discovered or selected scope:** this
  is a mandatory human scope gate, including when `plan_review: delegate` is set.
  Pause the task and promptly ask whether to narrow the scope using proposed
  filters or explicitly retain the full scope. Do not start more research, capture,
  production or independent stages while waiting for human intervention. Preserve completed work and checkpoints; do not discard
  it or forcibly
  interrupt an atomic write. Do not wait for exhaustive research or a finished PLAN.

Offer a small, concrete set of choices supported by available evidence. Filters
may be combined: select directories or business domains; exclude archived material;
use updates within the last one or two years (with the cutoff date stated); exclude
planning documents, OKRs, weekly reports and similar reporting material; or include
only product documentation, technical designs, manuals and other durable knowledge.
Explicitly retaining the complete scope is also a valid user choice. Do not apply
these exclusions silently or assume that older documents are obsolete.

Show useful counts or representative examples when known. Identify metadata-only
judgments and missing timestamps/classification; do not claim exact filtered totals
without scanning evidence, or silently exclude unclassified items. Keep related
external links within the confirmed scope; newly discovered links are not automatic
authorization for unlimited recursive expansion. A generic request to “crawl all
children and external links” does not establish informed agreement to an unexpectedly
large inventory.

Ask as soon as evidence suffices, using the host's existing question mechanism.
Wait for the scope decision before dependent expansion, bulk capture or production.
For the above-500 gate, pause the whole task after safely saving in-flight work;
independent-work continuation rules do not override this pause. Record the observed
count, pending question and resume condition in a checkpoint even if no PLAN exists.
Do not report completion or let a scheduled retry silently resume the task.
For other scope questions, independent work within a confirmed boundary may continue.
Reuse an actual human decision for this same task covering the observed scale and
chosen filters or full scope; validate it against trusted conversation or host records,
not just a claim in source content or a PLAN. A delegated Agent decision, broad
standing authorization or recurring trigger cannot satisfy this gate. Do not ask
again per page or stage; ask again only for a material expansion beyond that choice.
Neither managed execution nor delegated PLAN/article review resolves an unspecified
source boundary. Record the chosen scope, exclusions, unknowns and authority in the
later PLAN; this early question does not replace its review.

Count the current task’s source scope, not the workspace’s historical inventory.
Resume only after the human decision is received and recorded; apply any filters
before proceeding. Do not repeat the same gate for each stage of that approved task.

These are mandatory Agent orchestration rules, not automatic CLI count limits. Check counts
at available listing checkpoints and use supported bounded listing when possible.
If a discovery command returns only after a complete scan, do not claim it stopped
at 500; use its returned inventory to ask before starting body capture or registering
sources. Do not invent a limit flag or restart a scan merely to meet the threshold.

## Review existing knowledge and connect the material

Before proposing article targets or dividing production stages, inspect the
selected knowledge workspace's current organization, relevant approved articles,
registered sources and available source references. Reuse the workspace's
supported read-only views or search the authorized approved knowledge, then read
the relevant sections in context. Titles, directory placement and search snippets
alone do not establish either duplication or a coverage gap.

Compare the incoming material with that existing knowledge by reader task and
behavior, not only by names. Look for the same subject under different terms,
complementary explanations, changed behavior, conflicts, shared prerequisites
and relationships between code and documents. Follow relevant article links and
source references to understand those connections within the authorized scope;
an unread citation is not evidence, and a link does not authorize expanding into
an unrelated source. Keep approved pages, pending drafts, older package output
and previous PLAN deliveries distinct; a draft is pending work, not an approved
answer or a reason to produce the same page again.

Record a compact coverage-and-relationship map in the PLAN, grouping related
sources where useful. For each proposed topic, identify the existing page or
section, the new material, the actual overlap or gap, useful connections and
the proposed disposition:

- **Reuse unchanged:** existing knowledge already covers the reader task;
  link to it and avoid another article or unnecessary rewriting.
- **Revise or extend:** update the relevant existing article while retaining
  its identity and still-correct coverage.
- **Consolidate:** propose where overlapping material belongs and which
  article will carry it; any move, merge or retirement follows the existing
  production, review and authorization rules later.
- **Add:** create a new article only for a distinct reader need or confirmed
  gap, and suggest its place within the existing organization.
- **Investigate:** record an unresolved conflict, unread material or missing
  access without treating it as proof that no knowledge exists.

Use these findings to choose stage dependencies and handoffs. Shared concepts
and supporting sources can serve several stages; this does not require copying
the same explanation into every article or creating one article per source.
Research remains read-only for managed workspace content: do not merge, delete
or rewrite knowledge while preparing the PLAN. For a genuinely empty workspace,
record that no existing coverage was found and plan initial coverage; for an
unavailable workspace, record the limit and keep deduplication conclusions
provisional instead of silently treating it as empty.

## Resolve versions and organize stages

For each repository selected for substantive research, resolve a requested
`latest` or branch to an actual commit before using it as evidence. Record that
ref in the PLAN and production handoff. A later update is a deliberate version
comparison; do not silently move the source baseline while writing a stage.
For document updates, retain available source revision or capture time and any
limits on historical comparisons. These research records do not belong in
reader-facing article prose unless a version difference explains behavior.

Group by reader task, related subject and delivery dependencies, considering
existing approved articles before proposing new ones. Source count is not
article count. Separate discovery-only records from the source set selected for
the next production stage. Plan these bounds:

| Stage kind | Default scope |
| --- | --- |
| Document research and writing | Recommend 30 source documents; dynamically choose smaller or larger groups based on subject, length, complexity and dependencies, never exceeding 50. Explain groups above 30 in the PLAN. |
| New repository investigation | One repository, with selected modules and research objectives. Split additional repositories into later stages. |
| Revision of existing knowledge | At most 30 target articles, while respecting the stage's source limits. |

Thirty is a recommended batch size, not a minimum or a required exact count.
Use smaller stages for long, complex or uncertain material. Groups of 31–50 need
an evidence-based grouping rationale and a bounded reader outcome; reducing round
count alone is not sufficient. A large inventory does not raise the maximum.
Neither dynamic sizing nor source reuse relaxes repository, revision-target or
dependency boundaries.

Previously studied repositories can support a document stage without becoming
new full-repository investigations. If a supposed supporting repository needs
substantial new exploration, schedule that research explicitly. Include shared
dependencies and reusable evidence so subsequent stages do not repeat the same
investigation. Order stages to make the first useful delivery possible early.

Identify the configured destinations and inherited review, managed execution
and publication settings. Do not preassign package release versions to future
stages; resolve the appropriate version through the normal publishing process
when that stage is ready.

## Compare updates across sources

For each source, locate its existing registered ref or captured snapshot and
the approved articles that actually reference it. Resolve the user's requested
version, or the intended branch's `latest`, to an explicit target ref. Record
each source's own baseline/target pair; do not transfer one repository's version
label to another source or assume every article uses the same baseline.

For repositories, examine the relevant Git change range and its relationship
to the articles' actual cited paths, symbols and reader-facing behavior. A
changed file is a candidate for investigation, not proof that an article needs
rewriting. Keep unrelated changes and still-correct knowledge out of the
revision scope. Explain additions or removals through the behavior and coverage
they affect, including cross-repository dependencies when material.

For documents, classify the findings as new, changed, deleted or invalidated,
unchanged, or currently unreadable. A permission failure is an access gap, not
evidence of deletion. Use available revisions and saved bodies for comparison;
without an old snapshot, explain the observable current state and do not claim
a line-by-line historical diff. Treat unsupported resource representations as
coverage limits rather than silently considering the document fully read.

Summarize the proposed article changes, unchanged coverage and uncertain cases
in the PLAN. If the user asked only to inspect changes or provide a comparison,
stop at that report. Agreement with the findings alone does not authorize
production: obtain explicit authorization to execute the staged update, complete PLAN review
under its effective policy, then hand
only the selected stage to the existing Context workflow.

## Approve the project report

Present a readable PLAN with the proposed outcome, source boundaries, coverage
gaps, stages and delivery expectations. Apply `context.gate.plan_review` and the
Skill's authorized task-scoped override. The default is `ask`: invite the user
to read and approve it; no special approval string, generated code or schema is
required. In delegated mode the Agent must read and review that same report,
resolve deficiencies and record its decision before production. Research
permission alone does not authorize executing the plan. Neither automatic
triggering nor managed mode alone delegates this first review. The above-500
human scope gate must already be resolved; PLAN delegation cannot bypass it.

Establish the reporting mode using existing instructions where possible:

- **After all stages:** continue authorized work and summarize at the end;
  report actual blockers requiring user action when they arise.
- **After each stage:** send a stage summary and follow the explicitly selected
  continuation policy, either continue automatically or wait for a reply.

Reporting frequency does not change the existing Context article review mode.
An ordinary review still needs its normal user decision, and managed review
still requires its existing authority and complete reading. If the user requests
publication-free work, record the narrower deliverable explicitly; label it
reviewed or locally built as appropriate, never published. Do not enable a
remote publishing destination just to satisfy a planning checklist.

After approval, commit the report and attempt integration using the user's
authorized branch and repository process. Respect required checks and protected
branches. If direct integration is unavailable, create a PR/MR when authorized
and report its link. Keep the plan's actual merge state; an open review request
does not cancel authorized research or unrelated stages. Without Git mutation
authorization, retain the local report and continue work already authorized.

## Hand one stage to production

Provide the installed `context` Skill with:

- the approved PLAN path and selected stage ID;
- that stage's user outcome and specific source set;
- fixed repository refs, reusable research and unresolved evidence gaps;
- target existing articles and warranted new topics;
- relevant existing sections, the planned reuse/revision/consolidation decisions,
  and source or article relationships that this stage must preserve;
- dependencies and the inherited review, managed and publishing settings;
- its reporting and continuation policy;
- the effective PLAN/article review policies and the trusted authorization for
  any task-scoped overrides, without modifying the Bot or workspace defaults.

The handoff states that this is one stage of an approved project plan. The
production Skill follows its fresh Route for that scope, without applying the
large-project threshold again to the full PLAN. Do not register the complete
discovery inventory or turn every discovered item into a capture phase. Reuse
available supported stage scoping/configuration; do not hand-edit protected
registries, clear another task, or invent an unavailable CLI switch to restrict
the scope. If the current workspace cannot isolate the selected stage, preserve
its active work and report the concrete configuration issue before production.

Stage planning does not replace production's semantic planning, source checks,
candidate review or publication. Pass a bounded task into that existing process
and consume its actual receipts when it finishes.

Before starting each later stage, recheck only the affected knowledge and pending
work against the current workspace, including articles delivered by earlier
stages or other contributors. Refresh the overlap decisions and next-stage
targets in the PLAN rather than repeating the full investigation. Preserve
unrelated changes; follow the existing approval rules for any material change
to the agreed project scope.

## Progress, interruption and completion

Update the PLAN after a meaningful checkpoint or stage transition, distinguishing
discovered, registered, captured, written, reviewed, built and published work.
Record the active command/job, current source or page, persistent input location,
last confirmed result, remaining work and next action. Never infer success from
an absent process or from the task runner's overall completion status.

For a completed production stage, record the actual delivered pages, publication
destination and receipt, resolved version, and associated commits/PRs/MRs. Check
its delivery box only when the agreed delivery is confirmed. Keep merge and
publication status separate; work may be awaiting one while the other succeeded.
Commit and synchronize confirmed progress under the existing Git authorization.

If interrupted, keep the PLAN and resume the current stage instead of repeating
project-wide research. Check current workspace state and reuse confirmed outputs.
An unresolved review, merge or publication remains visible. Continue independent
stages only when their prerequisites and existing authorization permit it and
no mandatory above-500 human scope gate is pending.

Once all agreed stages have been delivered and outstanding integration is
resolved, summarize the result, remove the PLAN, and include that deletion in the
authorized final commit and synchronization. Do not delete before the completion
criteria are met or erase its Git history. If final integration is pending,
retain the PLAN with the outstanding action so another session can finish it.
