---
name: context-run-indexer-post-author-composer
description: Execute one CLI-authorized post-author composer request without changing primary facts, identity, scope, or composer selection.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: post-author-composer-step
---

# Run one post-author composer

Read the current Route input and the exact `context.indexer.layer-fragment-request/v1`.
Use only its bounded `primary_result_view`, selected `composer_ref`, allowed target refs,
and the resolved instructions supplied by Context. Do not discover another Skill or
composer, read project files outside the request, change a SubjectKey, create a complete
primary Result, or widen the target set.

Return exactly `context.indexer.layer-fragment-result/v1`. Preserve the request digest,
composer ref, and consumed PrimaryResultView digest. Return only zero or more
`derived-artifact-proposal` fragments for allowed targets. Context performs final schema,
identity, evidence, policy, layer, and receipt validation before accepting the Result.
