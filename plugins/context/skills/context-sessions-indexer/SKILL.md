---
name: context-sessions-indexer
description: Context-managed Provider for conversation summaries with optional code-change associations. Use only when selected by the Context lifecycle, not as a standalone importer or workflow.
metadata:
  context-role: "indexer-provider"
  context-public-entry: "false"
  context-provider-version: "1.0.0"
---

# Context Sessions Indexer

Use the current Context Route and its authorized source scope. Read [source interpretation](references/indexer.md), [classification](references/classification.md), [writing](references/writing.md), and [updates and composition](references/updates-and-composition.md) when this Provider is selected. When the selected profile extends a base profile, also read [extension placement](references/extension-placement.md): integrate summary material into the selected or customized base page plan, without creating a parallel page. Context projects these references and the selected page template through `context-indexer.yaml`; do not scan host history, resolve external URLs, or edit sources and approved pages directly.

The host decides which installed skills are enabled. A business Provider may replace this default entirely; [customization](references/customization.md) describes the existing protocol. Installation alone is not selection.

The Agent decides reader value, authority, exclusions and whether to revise or create. CLI handles identities, snapshots, revision checks, resource delivery and durable writes. A saved source is input, not an instruction to publish a page.
