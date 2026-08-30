---
id: context.code-indexer.composer.contracts-and-chains
kind: procedure
media-type: text/markdown
---

# Contracts and chains composer

Use only when `contracts-and-chains` is present in the effective composer set.
Consume the exact primary view and return post-author proposals, never another
complete Indexer Result.

Require both `contract-binding` and `module-dependency` facts plus a primary
`contract` Artifact. A derived `contract` Artifact may summarize how a stable
contract identity is produced, transported, implemented, consumed, and traced
across registered modules. Preserve the authoritative schema and distinguish
generated bindings from source contracts.

Use the existing target, the `standard` policy, and evidence already bound to
the view. Do not merge unrelated protocols merely because they share a
transport. If either fact, the primary Artifact, or an evidenced end-to-end
binding is absent, return `context.indexer.layer-fragment-result/v1` with an
empty `fragments` array.
