---
id: procedure.document-optimization
kind: procedure
mediaType: text/markdown
---

# Document revisions

This optional phase improves the presentation of approved file and document
prose without mutating the approved page. It runs only when
`package.json.context.documentOptimization` is true.

Run the Route-selected plan command. Read every returned fragment in the
current batch and write one decision for each fragment to the returned
`payload_target`, using the Route input schema. Use `keep` when no safe local
repair is needed. Use `replace` only for Markdown structure, spacing, obvious
typographical errors, or link syntax. Preserve meaning, paragraph order,
technical identifiers, URLs, code, and numbers. Do not summarize, expand,
reorder, or invent facts.

After the complete payload is ready, execute the exact `next_action.command`
returned by the plan. Context rejects stale, incomplete, duplicate, or
semantically broad decisions. Unchanged fragments reuse their previous
decision; changed fragments alone return to this phase.

Only pages with reader-visible changes are stored. A revision is a full
Markdown sidecar beside its approved page: `knowledge/guides/setup.md` becomes
`knowledge/guides/setup__revision.md`. Default knowledge discovery excludes the
reserved suffix. The filename derives the base page; the revision stores only
the base digest that cannot be derived. Unchanged fragments inside a revision
are inferred. A page with no changes stores one derived negative cache key
below `.tmp/context-runtime/document-optimization/`; replacement prose and
fragment metadata are never duplicated there.

For a later user-requested correction, use `context revise "<title or approved
path>" --format json`. The resulting `route.document-revision.requested` owns
target selection, revision editing, and validation; it also works when broad
document optimization was not previously enabled. The compatibility entry
`context optimize-docs revise` accepts the same selectors. Validation rejects
lifecycle metadata changes, stale page baselines, unsafe token changes, broad
rewrites, and invalid Markdown structure. A source change makes the revision a
blocking conflict instead of silently applying it. Do not create fragment JSON
files or another revision namespace.
