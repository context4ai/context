---
name: context-markdown-indexer
description: Context-managed Provider for evidence-bound document knowledge. Use only when the Context Indexer lifecycle selects this Provider, not as a standalone workflow.
metadata:
  context-role: "indexer-provider"
  context-public-entry: "false"
  context-provider-version: "1.0.0"
---

# Context Markdown Indexer

Provider authors must satisfy
`node_modules/@c4a/context/docs/guides/markdown-indexer-skill-authoring.md` and
the shared Provider/customization guide before publishing or extending this
Skill. Those documents are authoring contracts; the current captured evidence,
workset and Route remain execution authority.

Use this Provider only through the Context Indexer lifecycle. Context supplies exact captured sources, profile authority, worksets, and evidence views; the Provider does not read arbitrary workspace paths or write approved knowledge directly.

The machine-readable authority is `context-indexer.yaml`. Context materializes the detailed guidance only after verifying this Bundle's release identity and complete file ledger.
