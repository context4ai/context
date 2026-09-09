---
name: context-run-indexer-post-author-composer
description: Execute one bounded batch of CLI-authorized post-author composer tasks without changing primary facts, identity, scope, or composer selection.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: post-author-composer-step
---

# Run a post-author composer batch

Read both required Route resources before acting:

- `resolved-indexer-instructions` defines the selected Composer's job;
- each `authorized-indexer-workset-view/task-NNN` is one complete, bounded PrimaryResult View.

Use only the target aliases and source aliases exposed by that View and the current Route.
The reading shows full fact values and page bodies; evidence bindings and runtime
receipts remain in CLI storage. `fact:N` and `artifact:N` refer only to this task's
View. Declared missing input kinds are settled by the CLI as empty results before
delegation; whether available material supports a useful derived page is your decision.
Do not discover another Skill or Composer, scan project files outside the View, change a
SubjectKey, rewrite the primary Result, or widen the target set.

Return exactly one result for every task key in the Action input. Keep task results
independent: one empty or failed result must not replace another task's proposal.

Return only the minimal semantic JSON accepted by the current Route:

```json
{
  "stage": "post-author",
  "results": [
    {
      "task_key": "task-001",
      "result": {
        "stage": "post-author",
        "outcome": "complete",
        "proposals": [
          {
            "target": "target:1",
            "artifact_kind": "content",
            "title": "Reader-facing title",
            "summary": "Why this derived page is useful",
            "sections": [
              {
                "key": "overview",
                "heading": "Overview",
                "markdown": "Reader-facing content",
                "source_refs": ["fact:1"]
              }
            ]
          }
        ],
        "diagnostics": []
      }
    }
  ]
}
```

If a task needs no derived Artifact, return `outcome: "complete"` with an empty
`proposals` array for that task. If one bounded input cannot be processed, return
`outcome: "failed"` with at least one diagnostic for that task and still return the
other task results. Context expands aliases, validates evidence and policy, creates
internal fragments and digests, then resumes the same production state machine.

An accepted empty proposal does not regenerate an approved page. Use the returned
workflow summary and registered maintenance targets to distinguish production
completion from outstanding user requests; Composer task names are not a revision
queue. If the Graph is complete, return to the Context entry to handle any
remaining authorized requests rather than declaring a missing Review/build.

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
