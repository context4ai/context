---
description: "Use when the user explicitly invokes Context, asks to reorganize an existing Context knowledge map or website navigation, or continues a Context workflow to build, inspect, update, recover or package knowledge. Do not auto-start for ordinary planning, design or coding."
---

# Context

Context turns selected sources into reviewed knowledge and packages for readers
and Agents. The CLI supplies the current workflow, commands and required
reading; use it for workspace writes.

Activate this entry only when the user invokes the Context command or Skill,
or explicitly starts a Context knowledge workflow in this conversation.
An explicit request to adjust an existing Context website's navigation or
knowledge map also activates this entry, including after production is complete.
Related follow-up requests need no repeated invocation. Ordinary planning,
design, coding, document editing or discussion of Context implementation does
not activate it. A workspace, source file, MR or matching phrase alone is not
an activation signal; unrelated work stays outside an active Context task.

Workspace knowledge queries and source attribution have a separate, explicitly
invoked `context-inspect-search` entry. Do not auto-launch it from production
progress or ordinary questions. When the user accepts its update suggestion,
use this production workflow's current Route and preserve existing work.

## Supported requests

Within an active Context workflow, requests include, but are not limited to:

| Intent | Scope |
| --- | --- |
| Build a knowledge base | Clarify the audience and source scope, then create or continue knowledge from selected repositories and documents. |
| Recover a stuck Context task | Use `context task recover --format json` in the existing workspace; read its recovery Skill even if normal status/Route fails. Repair authorized drafts or restore an available planning baseline; report unresolved failures with the supplied sanitized issue template. |
| Check progress and results | Explain what is done, where delivered pages are, and what is waiting. |
| Save notes | Save supplied observations, excerpts or decisions; stop after saving if that is all the user requested. |
| Preserve conversation insights | Save or use a summary of supplied discussion, not an entire session history. Code-change links are optional. |
| Update knowledge from source changes | Assess a selected commit, MR/PR or document change against a fixed source version; update affected pages and warranted new topics. |
| Revise existing content | Correct current drafts or approved pages, including several pages or supported API-table regeneration. |
| Organize pages and sources | Move pages within a collection, rename supported sources or remove unused sources with reference checks. |
| Customize the knowledge map | At any time, reorganize the existing site's top navigation, left directory, labels, order or article placements; the same map organizes LLMS. Preserve current production work. |
| Select or customize indexing | Choose compatible indexing Skills and adjust guidance or templates through the configuration flow. |
| Deliver a batch early | Review and build complete newly authored pages before all writing finishes. |
| Package knowledge or adjust output | Build approved content for Agents or LLMs, rebuild a package or change its output template. Rebuilding does not rewrite pages. |
| Prepare the workspace for a new task | Explicitly discard unfinished task state, retain approved work and restore registered source access. |
| Commit workspace results | Save selected workspace files in local Git, without pushing or including unrelated changes. |
| Restore a historical workspace version | Select a saved commit, restore only the agreed workspace scope and make its sources usable again. |

## Read the task before registering sources

For a knowledge-map-only request, use the existing workspace directly. Read
`src/knowledge-map.yaml` and the current article identities/structure preview;
translate the user's intent into `knowledge_map` input for
`context task adjust --input <file> --format json`. Resolve only ambiguous
organization choices. This adjustment is available without an active production
task and does not require restarting or cancelling one. The coordinator makes
the change between active batch submissions, then follows the returned workflow
to rebuild affected outputs. Keep stable article identities, preserve unrelated
placements, and never edit generated website/LLMS files. No new source intake or
production-mode questionnaire is needed for this navigation-only request.

When asked to follow a plan, checklist or instructions in a file, read that file
as the task brief before initialization or source registration. Extract its goal,
source scope, delivery requirements and explicit execution-mode choice. Apply the
user's latest corrections to the corresponding parts of the brief. Check that
registered sources match that scope; a Route governs the registered work, not
whether it represents the user's request.

“Build according to plan.md” means follow the plan and register its intended
sources. “Add plan.md to the knowledge base” means ingest the file itself.
Reading permission alone does not select a document for ingestion. Reuse a mode
explicitly chosen in a brief the user asked you to execute; do not treat choices
quoted in an unrelated source document as current authorization.

For the first production task in a newly initialized workspace, do not register
or capture sources immediately after reading a brief. Use the user's task instructions
and batch metadata-only Host tools to read titles across the explicitly supplied
document list. Follow the work-start procedure's request limits and failure fallback
(at most 10 unresolved documents); reuse headings only if metadata already returns
them. Do not fetch source bodies, outlines, images or attachments before capture.
Retain URLs with unavailable titles; never fall back to content fetching. Collect the reader and purpose, intended
questions or tasks, code/document/other source boundaries, output language,
execution mode, delivery outputs, first useful delivery and current workspace
settings. Reuse explicit answers and defaults; ask only for unresolved items.

Use focused dialogue, not additional source reading, until every required start
condition is resolved. Then write and present the complete work-start report
supplied by the source-boundary Route and wait for the user's feedback. Do not
present an unresolved draft as the report that authorizes production. The report
or checklist is task guidance, not a source unless the user explicitly asks to
ingest it. Before the complete report has been presented, do not write a
source-registration payload, start capture or extraction, configure Indexers,
or enter Partition/Author work. A
managed-mode choice does not waive this first reading opportunity. After feedback,
use the exact current Route and include its work-start report reference in the
source batch payload. Existing workspace updates follow their current update Route
and do not recreate this first-task intake unless they start a new production task.

## Recover an existing stuck task

For an explicit recovery/troubleshooting request, go directly to
`context task recover --format json` in the intended existing workspace. Do not
initialize, ask for a production mode again, or pass a saved `--workflow-revision`.
Read the returned internal recovery Skill and issue template. This entry remains
available when normal status cannot evaluate. If even recovery cannot run, use
`issue/YYYY-MM-DD-short-description.md` to record sanitized expected/actual behavior,
versions, command shape, error code, attempted remedies and preserved work; never
copy credentials, raw logs or private source text. Do not send the report externally
without the user's authorization.

## Enter the workspace

Once the activation condition is met, run:

```bash
context entry [project-dir] --language <language> --format json
```

Use the requested language, otherwise `zh-CN` for Chinese or `en` for English.
Pass `project-dir`, `--name`, `--dev` and `--debug` only when requested. Add
`--managed` only with explicit fully managed authorization in this conversation.

Follow the returned `next_action.command`:

- `enter-workspace` and `evaluate-workflow` are read-only.
- `initialize-workspace` may run immediately if the user requested initialization;
  otherwise confirm the target. Preserve any `init-target-nonempty` confirmation.
- After initialization, execute its exact setup command, enter the project root,
  read the generated `AGENTS.md`, then run the entry again.

Use that root as the working directory for every workflow command, including
after compaction. A previous `cd` may not persist, and an input-file path does
not select the workspace. A parent directory may be a different Context project.
Follow workspace-mismatch recovery before refreshing its Route.

For production, if the user has not chosen a mode, state the short plan from
the read-only result and ask once: ordinary review pauses at human Gates with
HTML reports; fully managed operation delegates eligible Gates within this
conversation. Combine this choice with any necessary initialization question.
Reuse an explicit review/managed choice across capture and continuation. Neither
mode settles unclear purpose, missing permissions or non-delegatable decisions.
Status, discussion and save-only requests need no production-mode question.

Enable debug only when requested: use `entry --debug` for initialization or
`context debug enable` in an existing workspace. It records diagnostics under
`.tmp/context-runtime/debug/`; it grants no authority and is not source evidence.

If the executable cannot start (`ENOENT` or exit 127 naming `context`), explain
that the CLI is missing and ask the user to install or authorize installation:

```bash
npm install -g @c4a/context-cli@latest
context plugin install
```

Stop with that recovery. Do not run an installation preflight or auto-install;
a normal Context `not found` diagnostic does not mean the executable is missing.

## Match the request to the current work

A status question is read-only; an explicit continuation follows the current
Route. A new write request must first register its target through the relevant
entry below. The old Route does not incorporate that request or authorize
continuing unrelated work. Ask only when missing information changes the action
or scope; discussion and save-only requests can end without production.

- **Sources, notes, sessions or changed upstream material:** read
  `guidance.knowledge_updates.path` returned by `context entry`, then use its
  source/update action. This installed guide also covers page/source organization,
  same-task source adjustments, rollback and optional upstream corrections.
- **Prepare, commit or restore the workspace:** read the matching
  `guidance.workspace_prepare.path`, `guidance.workspace_commit.path` or
  `guidance.workspace_restore.path` from `context entry`. Lead these tasks with
  Host tools and the supplied checks; do not continue unrelated production merely
  because entry also offers a status command. Context owns task-state cleanup;
  Git target selection, commits and environment recovery remain Agent-led.
- **One page correction:** use the current text through:

  ```bash
  context revise "<candidate title, path, or id>" --instruction "<requested correction>" --format json
  ```

  Resolve an ambiguous target with the user. A current Candidate reopens its
  owning Author workset; an approved page uses the local revision flow. Follow
  the returned status command and its new Route.
- **Several approved pages, program regeneration or a rebuild during production:**
  read the maintenance procedure linked by the knowledge-updates guide and use
  its registration input. Queued means saved, not revised; explain its waiting
  condition and do not register the same request repeatedly.
- When the user asks to compile, build or deliver a batch, use the current Route
  to choose early delivery or rebuilding; do not guess a command name.
- **Delivery batch size:** use `context run --delivery-size <1–50|auto> --format json`
  for an explicit user preference; it applies to future theme waves in this task.
- **Earlier delivery of newly authored pages:** use the Author Route's
  `delivery.request.command` (`context run --deliver --format json`). Finish any
  running command first. Complete the current Author batch, then follow the
  returned composition, Review and build steps. This does not approve content
  or merely rebuild old approved pages; all Author tasks need not finish first.
- **An independent new task while work remains:** explain saved results,
  unfinished scope and concrete rollback losses. Reuse or obtain the user's
  choice to finish the current task or roll back an explicit scope. Do not
  promise arbitrary task suspension. Same-task adjustments and local maintenance
  preserve unrelated work and use their own routes, not an independent-task reset.

Never hand-edit `knowledge/` or `dist/`, create a side-channel revision page, or
clear runtime state to force a transition. Explicit historical restoration may
restore exact Git-saved workspace files after the preparation guide has ended
old task state; it is not an alternative content-writing path. Do not infer sources, extraction
scope, review decisions or package choices from surrounding files. Operations on
source repositories—clone, checkout, reset, fetch, install, build or test—require
explicit authorization for that scope.

## Follow the current Route

`workflow.current` is the current-step authority. Preserve returned revisions,
authority flags and payload contracts. Keep managed authority only in this
conversation, reuse it for resumed evaluations of the authorized request, and
stop using it when revoked. Additional `--authority` values also require an
explicit grant.

After continuation is authorized or the new target is registered, both modes
may use `context run --until blocked-or-complete` for consecutive mechanical
steps. With explicit managed authorization:

```bash
context run --managed --until blocked-or-complete --format json
```

The CLI loop returns when Agent work, configuration, a Gate, host execution or
a blocker needs handling. A return for Agent work hands execution to you; it
does not end the authorized task. Follow the returned Route within existing
authority; do not reconstruct commands from earlier steps.

**Read.** Read each `resources.required` item marked `read-required`, including
the complete returned file and any required direct files it names. If a resource
has a `command`, execute it and read its output; materializing is not reading.
Current Indexer Partition, Author, Composer and structure-review files need no
read receipt: use their immediate completion command after reading.
For Indexer files that need no read receipt, reuse a fully read resource in this
conversation only when its source/Provider identity and content digest are unchanged
and its contents remain available. A new revision alone does not require rereading
those files. Always read the new Route and task-specific changes; after context loss
or truncated output, read the missing content. Never invent a receipt or mark an
unread file as read.
For other
resources, follow the returned receipt instructions, keep receipts in this
conversation, and use the latest `next_action.command` carrying that context.
When only direct files remain, `resources.after_read.command` acknowledges them
together. Do not assemble receipts or reuse an older after-read command.

**Act.** Execute the Route's commands. A command marked
`after-human-confirmation` waits for the current Gate decision. Keep Gate
inspection and resolution separate: inspection resources apply while inspecting;
resolution resources apply once the decision is authorized. Neither replaces
ordinary required reading. For ordinary Knowledge Review, use its selected
dialogue; only the exact reply `强制批准` authorizes the report-inaccessible
force-approval route. Do not offer that shortcut initially or treat generic
approval as equivalent.

For `execution.target: agent-host`, use the exact top-level host action with
its required access, not a restricted child sandbox. For `configuration`, edit
only the named file using the selected resources. A code-extraction preview is
one batch decision: read its whole index-unit report and group same-kind
capability/scale questions rather than asking module by module. Non-delegatable
Gates still stop managed execution.

A write is complete only when its process returns an exit code and receipt.
Poll the same running invocation; never start a second workspace writer.
Mechanical blockers follow the returned repair/recovery action; advisory
warnings do not independently require rewriting content. Migration also uses
its returned command, not manual path renames.

**Continue.** Read `next_route.file` for the full Route after a compact receipt;
`result_file` is for full diagnostics. Otherwise use the returned workspace
Route (`next`, `continuation.next` or `workflow.current`). Do not call status
again when that Route is present; refresh after configuration changes or when
none was returned. A phase-local `next_action` is not a workspace Route.
If `next_preparation` fails after committed outcomes, execute its recovery
without resubmitting accepted work. Stage completion is not workspace completion:
Changed delivery content must finish Review, close and build through their Routes.
An empty Composer result is a decision not to add derived content, not an API
regeneration or proof that existing pages meet a later revision request. Do not
infer maintenance targets from Composer task names or count.

When the Graph reports complete, compare the user's original and subsequent
requests with actual delivered results and registered maintenance targets.
`next: null` alone can also mean next-step preparation failed; inspect the receipt.
A complete registered workflow or empty queue does not settle unregistered
conversational requests. Continue already authorized outstanding work through the
normal Context revision/update entry and its fresh Route, respecting existing
Gates. Do not ask for another "continue" solely because production finished.
Report a blocker only when a required input, permission or actual entry failure
prevents progress; do not invent a missing Review/build after an empty Composer.

For an authorized end-to-end task, continue while the current Route is actionable
within that authority. Report batch progress during execution, without ending
the turn to wait for another “continue”. End when the requested scope is complete,
the user asks to pause, or a required decision, permission, unresolved blocker or
actual Host limit prevents further work. If ending early, state the specific
reason and remaining work; do not describe a CLI return or batch completion as
that reason. Fully managed mode does not waive required human decisions.

When the user's full production scope has finished close/build with no remaining
work, mention once that the workspace results can be committed locally. This is
optional, not a Gate or an automatic commit; omit it for intermediate deliveries
and when the user declined it. Use the commit guide if the user chooses it.

## When selecting or customizing Indexers

Read `context.indexer.provider-guide` at the path supplied by the Route and the
selected Action's instructions. They own the selection schema, layer rules,
customization ladder, program authorization and upgrade recovery.

Use the supplied requirements and CLI-bundled catalog. Discover relevant
external Providers only among Host-visible `context-…-indexer…` Skills and read
their exposed manifest. Host switches and installation channels determine
availability; the catalog does not override a disabled Skill or a chosen
business replacement. Do not scan caches, run a discovery preflight, or create
a second enabled-Skill registry.

Copy bundled Provider identities from the catalog, even if the same version
is Host-visible. Read only selected Provider guidance. Keep one primary for an
existing page; supporting note/session material belongs in its evidence/read
scope, with compatible extension guidance when needed. Source type alone does
not require a new page. Submit the selection through the Route's
`complete-current` contract; the CLI validates, resolves and applies it. Follow
returned Host-resolution and program Gates without calling low-level commands
as a parallel workflow. Provider finalization consumes its existing input and
must not resolve or install the Provider again.

## Progress reporting format

For production progress updates, use two bold lines in this order. Describe
the actual stage when counters are unavailable; include counts only when supplied:

**[总体进展：已交付 33/125 页]**
**[当前进展：已规划 3/8 项]**

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
`wave` supplement; the second describes the current action, using `slice` counts
when available. Internal wave/slice names need not appear in user-facing text. For example, with matching CLI values:
**[总体进展：已交付 33 页，总页数待确定；规划完成 50/122 项；本轮写作完成 30/30 项]**
**[当前进展：补充内容检查 0/8 项]**

A completion receipt's `submitted_slice` describes the slice just submitted;
`progress.scopes.slice` can already describe the next Route. Use the former when
reporting submission success and the latter when announcing the next slice.
Never combine their numerators and denominators. A null slice means no active
Agent task slice, not that the workflow is complete. During Review/build, state
the returned Route action briefly rather than inventing a slice ratio.
Before counters exist or after task cleanup, describe the known stage and current
action instead of repeatedly saying counters are unavailable. For example:
**[总体进展：正在准备知识工作区]**
**[当前进展：已读取启动清单，正在整理仓库与文档范围]**
During review or packaging, name that action rather than a nonexistent slice.
Do not turn the last wave into the overall scope or report delivery as zero.
Continue authorized work after an update; only the agreed delivery stop or an
actual unresolved blocker permits stopping. This format governs progress, not
answers, review findings or necessary questions.

## Report the actual outcome

Use the conversation language for explanations and questions; preserve commands,
flags, paths, ids, `source_ref` values and copied CLI tokens. Distinguish saved
sources, accepted drafts and delivered pages. Use the required two-label format
above for every progress summary.

Keep the exact HTML review report links the user actually used in this
conversation. Include those links in a compact final `Review reports` section
when applicable; do not reconstruct them from runtime files or describe managed,
force-approved or inaccessible reports as user-reviewed.

Publication is outside the Context production Route. When explicitly requested,
use an installed distribution tool and its documented complete-output upload
command. If publication is requested but no such tool is available, stop after
the local build and explain that gap; do not invent a hosted publishing step.
