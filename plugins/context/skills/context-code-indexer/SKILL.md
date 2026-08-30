---
name: context-code-indexer
description: Context-managed Provider for evidence-bound code knowledge. Use only when the Context Indexer lifecycle selects this Provider, not as a standalone workflow.
metadata:
  context-role: "indexer-provider"
  context-public-entry: "false"
  context-provider-version: "1.0.0"
---

# Context Code Indexer

Provider authors must satisfy
`node_modules/@c4a/context/docs/guides/code-indexer-skill-authoring.md` and the
shared Provider/customization guide before publishing or extending this Skill.
Those documents are authoring contracts; the current workset and Route remain
execution authority.

Use this Provider only through the Context Indexer lifecycle. The workspace registry selects an exact profile, version, integrity, scope, and operation. Do not scan outside the supplied workset or write project files directly.

The machine-readable authority is `context-indexer.yaml`. Detailed authoring guidance is materialized by Context from the registered Bundle after its file ledger and integrity have been verified.
