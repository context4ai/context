---
name: context-markdown-indexer
description: Context-managed Provider for source-grounded document knowledge. Use only when the Context Indexer lifecycle selects this Provider, not as a standalone workflow.
metadata:
  context-role: "indexer-provider"
  context-public-entry: "false"
  context-provider-version: "1.1.1"
---

# Context Markdown Indexer

Provider authors must satisfy
`node_modules/@c4a/context/docs/guides/markdown-indexer-skill-authoring.md` and
the shared Provider/customization guide before publishing or extending this
Skill. Those documents are authoring contracts; the current captured evidence,
workset and Route remain execution authority.

Use this Provider only through the Context Indexer lifecycle. Context supplies exact profile/workset authority and one Authorized Workset View containing the permitted captured evidence. The Provider does not open source-specific readers, manage pagination/receipts, read arbitrary workspace paths, or write approved knowledge directly.

Treat the captured document as reader material, not as pipeline metadata. Every
reader Artifact must preserve or synthesize the source-backed guidance needed by
the selected profile. A heading inventory, directory summary, generic document
description, internal Fact/View/digest count, or a sentence sending the reader
back to the source is not useful knowledge and must not be emitted. Keep
execution receipts, content digests, internal refs, and other recovery machinery
out of reader Markdown. Bind each reader claim only to the smallest relevant
source span or captured evidence set; never attach a whole document corpus or
Authorized Workset View to a generic summary.

The machine-readable authority is `context-indexer.yaml`. Context materializes the detailed guidance only after verifying this Bundle's release identity and complete file ledger.
