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
