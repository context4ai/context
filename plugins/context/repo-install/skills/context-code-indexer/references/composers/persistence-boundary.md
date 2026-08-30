---
id: context.code-indexer.composer.persistence-boundary
kind: procedure
media-type: text/markdown
---

# Persistence boundary composer

Run only for an effective `persistence-boundary` selection. Consume the exact
`PrimaryResultView` and keep all proposals subordinate to its Node and Result.

Require an evidenced `persistence-binding` fact and primary `content`
Artifact. Derived `content` may connect the domain operation to repository or
store, model/schema authority, transaction or consistency boundary, caching,
migration, failure, and recovery. Separate authoritative schema sources from
generated models and runtime observations.

Use `standard` and existing evidence. Do not infer storage semantics from a
driver dependency or method name. If the binding, required Artifact, or a
source-backed persistence question is absent, return a valid empty fragment
set rather than reading outside the workset.
