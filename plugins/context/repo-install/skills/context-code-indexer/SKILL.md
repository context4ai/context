---
name: context-code-indexer
description: Investigate code skeletons and write source-grounded Context articles for an authorized module. Use when selected for the current planning or writing task, not as a standalone repository audit.
metadata:
  context-role: "indexer-provider"
  context-public-entry: "false"
---

# Context Code Indexer

Follow the current Context stage's purpose, module boundary and file submission
schema. Read [investigation and writing guidance](references/indexer.md).
The skill helps discover a useful skeleton and explain code; it does not own
the module, its articles or their permanent provenance.

During planning, start with the supplied directory and file navigation.
Identify relevant technology and visible capability families, optionally
inspect representative source, and propose reader topics and writing batches.
Do not start full-repository parsing, enumerate every symbol or build a
relationship graph to satisfy planning. Name partial counts as partial.

A module may use several selected Indexer skills for different technology or
content. Their findings can support the same article. Do not register a
primary/extension binding, verify skill hashes or versions, or record skill
identity in articles. The plan's temporary skill guidance is sufficient.

During writing, inspect the actual implementation and contracts needed for
each reader question. Put complete new Markdown and reference files, or
fragment edits for a supplied base article, in the Agent temporary directory.
Submit through the current CLI action; do not write formal knowledge or modify
the source repository. Missing material blocks only the affected scope.
