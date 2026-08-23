---
id: procedure.document-optimization
kind: procedure
mediaType: text/markdown
---

# Document optimization overlays

This optional phase improves the presentation of approved file and document
prose without mutating `knowledge/`. It runs only when
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

Only pages with reader-visible changes are stored. Each page uses the same
relative path and Markdown evidence protocol as its approved source, for
example `knowledge/guides/setup.md` becomes `overlays/guides/setup.md`.
Fragment-level `keep` decisions and incremental state are compact runtime cache
below `.tmp/context-runtime/document-optimization/`; never edit that cache.

Use `context optimize-docs override <fragment-id>` to create or locate the
corresponding page overlay, then edit only reader-visible prose inside the
existing `context:section` boundaries. Run `context optimize-docs validate`
after editing. It rejects lifecycle metadata changes, stale page baselines,
unsafe token changes, broad rewrites, and invalid Markdown structure. A source
change makes the page overlay a blocking conflict instead of silently applying
it. Do not create fragment JSON files or another overlay namespace.
