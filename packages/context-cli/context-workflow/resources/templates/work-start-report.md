---
id: template.work-start-report
kind: procedure
mediaType: text/markdown
---

# <Task name> | Work-start report

Open with who will use the knowledge, what it will help them do, and the first
pages they can read. Use connected prose. State a concrete reading milestone;
estimate time only when supported by actual conditions.

Briefly explain what the agreed execution arrangement and observed debug setting
mean for the reader. Do not announce the language already used in this report.

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

## What we read and learned

Explain useful findings across the materials already read. Say which sources
explain what, and which links were only retained without reading their targets.
Name actual documents, images or attachments instead of internal processing terms.
Link supporting material beside a conclusion when useful. Do not turn this into
a reading log or claim implementation, completeness or verification beyond what
was actually inspected.

## Scope and choices

Describe what will be covered, what serves as background, what is excluded and
why. Preserve choices about priorities and missing information. Distinguish user
decisions, existing agreements and your proposed arrangements; source access or
managed permission alone does not confirm purpose, depth or version choices.
Name the useful regions and supporting materials rather than copying the source
list. If a meaningful boundary remains unchecked, say what needs checking. When
excess scope is a real concern, briefly explain the extra reading, token use and
duplicate or conflicting output it could cause; do not invent measured savings.

## What we will deliver

Connect each content group to the reader's situation, task and expected page form.
Express supported content categories in these page descriptions, not a separate
internal classification column. Use the table only when comparing several groups
helps; otherwise use a paragraph.

| Content group | Situation and task it helps with | Page form |
| --- | --- | --- |

Give an estimated page count or range with its basis in a short paragraph. If no
reliable estimate is possible, state what is already known, the concrete remaining
work needed to estimate it and when you can revisit it. An internal stage name is
not an explanation. Do not invent counts, imply that a check happened, or scan more
material just to fill a number. Explain the delivery order after the first pages.

## Suggested reading organization

Recommend one main reading route from representative material and the reader's
purpose. Combine these starting points when useful; they are not required
folders, a closed classification or additional source profiles.

| Starting point | Reading route | When supported |
| --- | --- | --- |
| Business scenarios | Overview → scenario/domain → rules, frontend and backend entries → investigation | Shared reader tasks across code and product materials |
| Engineering modules | Application/service map → module → entry and specialized articles | Maintenance and implementation questions |
| Component or public library | Getting started → capability/component families → reference → migration | Public APIs or reusable UI, with shared configuration written once |
| Product | Overview → users/scenarios → operations → rules → support and acceptance | Product documents; no technical chapters required without code material |
| Design system | Principles → foundations/tokens → themes/platforms → components → adoption | Actual system materials, not an inferred system from component code alone |
| Operations and quality | Task/problem entry → procedure/investigation → tools → validation/cases | Operational instructions and real quality evidence |

Use article responsibilities when explaining the proposed chapters: business
navigation combines C01–C03 and D01–D04 with linked F/S/Q entries; engineering
maps combine C01, F01–F12 and S01–S07; public UI libraries use L05/L02, while
SDKs use L01/L04 without UI-only chapters. Product material uses the selected
product, guide and policy profiles, with supported QA articles; design systems
use L03 and link L05/L02 implementations; operations use C05, D04 and Q01–Q07
alongside supported SOP, FAQ or incident articles. IDs are optional explanatory
references, not a questionnaire for the user.

Select a primary route from actual reader tasks, source kinds and existing
knowledge; repository count does not determine the menu. Distinguish a link-only
navigation group from a sourced overview and a separately useful specialist
article. Reuse the same article under multiple groups. If detailed evidence is
missing, retain a truthful source map or a tentative proposal, never an empty
published page. A pure product workspace needs no frontend/backend hierarchy;
a business workspace may include an internal library without becoming two
workspaces. Explain meaningful alternatives only when a tradeoff exists.

Show a compact directory tree or a table with proposed entries, article types,
suggested chapters, supporting material and initial priority. Distinguish navigation
groups from proposed articles. For repeated modules expand one representative,
then point to the known module list; do not pretend sampling completed planning.
Explain why an article deserves its own page or could be combined. Suggestions
are not delivered links, confirmed page counts or a reason to create empty pages.

Keep this proposal inside this report. User feedback changes the proposal and
subsequent formal planning through existing actions. Reuse settled choices and
honor an explicit waiver of the first feedback wait. CLI does not parse this
Markdown to infer approval, source ownership or runtime configuration.

Reading organization is independent of knowledge collections and KB packaging.
The same article can appear under several reader groups without duplicate bodies;
output channels resolve their own paths. Moving a menu entry does not cancel a
required question, move source files or require parsing again. Record material
scope changes using the existing requirements flow. Suggested headings, writing
style and ordinary version differences are advisory; let the Agent judge content
and preserve source coordinates and a useful next investigation step.

## What could be misrepresented

For one to three actual pitfalls, name the objects that could be confused or the
information that could be lost, and explain the consequence for the reader.
Avoid generic warnings; omit this section when no concrete pitfall is known.

## Indexer choices for this work

An Indexer is a skill that turns particular source material into useful knowledge.
Use the current Route's catalog, visible relevant Indexer Skills, actual selection
and source reading to fill this table dynamically. Include the available Indexers
not selected and why. Do not copy a fixed list of skills from this template.

| Indexing skill | What it helps explain | This work's choice | Expected effect on module or text coverage | Reason |
| --- | --- | --- | --- | --- |

Name the actual modules, documents or text groups each choice would affect and
what knowledge it would add or leave out. State whether a choice is proposed,
already configured, or not selected; distinguish unavailable from unnecessary.
Describe expected coverage, not completed work or edits to the source materials.
If the catalog or impact is not yet known, say what remains to be checked rather
than treating missing information as a decision not to use a skill.

## Remaining gaps

Include unresolved local gaps with a handling plan. Settled choices belong in
scope; core purpose/scope questions must be resolved through discussion before
dependent work, not hidden here.

| Missing information | Affected content | Current handling | When to discuss again |
| --- | --- | --- | --- |

Omit this section if empty. Remove template instructions, empty tables and
placeholders from the actual report. Write in the user's language.

---

Related requirement: <link to existing requirement or workspace location; add existing names/IDs only as needed>
