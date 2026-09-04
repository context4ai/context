---
name: context-run-indexer-post-author-composer
description: Execute one CLI-authorized post-author composer request without changing primary facts, identity, scope, or composer selection.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: post-author-composer-step
---

# Run one post-author composer

Read both required Route resources before acting:

- `resolved-indexer-instructions` defines the selected Composer's job;
- `authorized-indexer-workset-view` is the complete, bounded PrimaryResult View.

Use only the target aliases and source aliases exposed by that View and the current Route.
Do not discover another Skill or Composer, scan project files outside the View, change a
SubjectKey, rewrite the primary Result, or widen the target set.

Return only the minimal semantic JSON accepted by the current Route:

```json
{
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
```

If no derived Artifact is needed, return `outcome: "complete"` with an empty
`proposals` array. If the bounded inputs cannot be processed, return `outcome: "failed"`
with at least one diagnostic. Context expands aliases, validates evidence and policy,
creates internal fragments and digests, then resumes the same production state machine.
