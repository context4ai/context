---
name: context-run-indexer-lifecycle
description: Continue Context investigation and article production only when selected by the workspace Route.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: workspace
  agent-graph.entry: context
---

# Continue current knowledge work

Use the current Route's command, resources and file contract. This outer action
has no submission of its own. Reuse the user's settled reader purpose and source
scope; ask only about a missing decision that changes the work, including in
managed mode. Explain decisions in the user's conversation language.

Start with authorized code skeletons and document outlines. Read original text
selectively to decide article topics and writing batches, then more deeply for
the actual claims being written. Skill guidance is optional assistance with
discovery and writing, not a version-bound production credential.

Submit the lightweight plan, present the work-start report and apply
`context.gate.work_start_scope` before writing. Reuse a matching explicit user
decision or ask when required. Use the report resources selected by the Route;
unchanged scope does not need another report merely because a batch ends.

Write in the issued Agent directories and submit completed subsets using the
returned file contract. Reuse available shared materials and follow the next
directory or recovery command; do not query full status between ready batches.
Only receipts establish acceptance. Distinguish drafted, accepted, reviewed and
built articles when reporting progress; no slice count proves whole-task completion.

Use multiple workers only when the current host supports them and the invocation
declares that capability. The coordinator owns shared CLI writes and each worker
uses its assigned draft directory. Keep all process state in `.tmp`.

For explicitly requested early delivery, use `context run --deliver --format json`
and follow Review, close and build. A successful delivery resumes remaining work;
`context run --resume-writing --format json` cancels the pause without discarding
drafts. Do not automatically request delivery after every subset submission.

Continue authorized work until its actual delivery boundary or a real missing
decision, source, permission or host limit. After cleanup, a new request starts
fresh production from formal articles and sources, not an old process ledger.
