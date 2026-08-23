# Document optimization overlays

Document optimization is an optional build phase for source-backed prose. It
repairs presentation-level Markdown without changing approved `knowledge/`.

Enable it during initialization:

```bash
context init context --optimize-docs
```

Or enable it in an existing workspace:

```bash
context optimize-docs enable
context status --format json
```

When enabled, the workflow plans only new or changed fragments. The Agent may
keep a fragment unchanged or apply a conservative replacement. Only changed
pages are stored, using the same relative Markdown path under `overlays/` as
their approved source under `knowledge/`. Compact fragment decisions stay in
`.tmp/context-runtime/document-optimization/` as rebuildable runtime cache.

To maintain an intentional presentation adjustment, create or locate its page
overlay:

```bash
context optimize-docs override <fragment-id>
```

Edit reader-visible prose without changing frontmatter provenance or
`context:section` boundaries, then run `context optimize-docs validate`. If
upstream content changes, the page overlay becomes a conflict and must be
reviewed again.

Disable and restore baseline output with:

```bash
context optimize-docs disable
```

Document optimization pages are moved to Context runtime recovery storage and
the next build uses approved knowledge directly. Unrelated future overlay
types are left untouched.
