---
id: context.code-indexer.composer.public-contract
kind: procedure
media-type: text/markdown
---

# Public contract composer

Run only for an effective `public-contract` composer workset. Consume the
workset-scoped `PrimaryResultView`; do not inspect a broader repository or
replace the primary Result.

Require an evidenced `public-surface` fact and its owning primary `content`
Artifact. Propose a `contract` Artifact only when the view establishes stable
consumer identities, entrypoints, behavior, constraints, and evidence. Group
related exports, commands, routes, or extension points by the public concept a
consumer uses; do not enumerate incidental symbols.

Every proposal must retain the existing target Node, use the `standard`
Artifact policy variant, and cite evidence already present in the view. Return
only a post-author `derived-artifact-proposal` fragment. If either required
input is absent or no independent reader question is supported, return the
normal layer-fragment result with `fragments: []`.
