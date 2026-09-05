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
