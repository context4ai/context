---
id: context.code-indexer.composer.public-contract
kind: procedure
media-type: text/markdown
---

# Public contract composer

Run only for an effective `public-contract` composer workset. Consume the
workset-scoped `PrimaryResultView`; do not inspect a broader repository or
replace the primary Result.

Require an evidenced `code-symbol` fact and its owning primary `content`
Artifact. Propose a `contract` Artifact only when the view establishes stable
consumer identities, entrypoints, behavior, constraints, and evidence. Group
related exports, commands, routes, or extension points by the public concept a
consumer uses; do not enumerate incidental symbols.

Every proposal must retain the existing target Node, use the `standard`
Artifact policy variant, and cite evidence already present in the view. Return
only a post-author `derived-artifact-proposal` fragment. If either required
input is absent or no independent reader question is supported, return the
normal layer-fragment result with `fragments: []`.

The `code-symbol` kind is the parser-backed fact carrier, not a guarantee that
an independent contract page is useful. Check its public entrypoints, visibility,
types and resolution limits. Do not turn declaration-only information into a
runtime guarantee, or duplicate an API table already present in the primary page.

Keep the distinction between display targets and supporting implementation/type
facts when assessing a derived page. An empty fragment avoids an unnecessary
derived page; it does not certify that a primary table is correct. Report a
concrete discrepancy for the existing Review/repair flow, without replacing the
primary Result or silently changing its generated rows. Stay within this
Composer's declared result schema and actions.
