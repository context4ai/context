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

Generated decisions live below `overlays/document-optimization/generated/`.
Tracked manual adjustments live below `overlays/document-optimization/overrides/`
and take precedence while their input and context digests remain current. Use
`context optimize-docs override <fragment-id>` to create a valid override
skeleton, then edit only the body between its markers. A source change makes a
stale override a blocking conflict instead of silently applying it.
