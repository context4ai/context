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
keep a fragment unchanged or apply a conservative replacement. Decisions are
stored under `overlays/document-optimization/generated/`; package build reads
the resulting projection, while approved knowledge stays source-faithful.

To maintain an intentional presentation adjustment, create a tracked override:

```bash
context optimize-docs override <fragment-id>
```

Edit only the body between the generated markers. If upstream content or local
context changes, the override becomes a conflict and must be reviewed again.

Disable and restore baseline output with:

```bash
context optimize-docs disable
```

The active overlay directory is moved to Context runtime recovery storage and
the next build uses approved knowledge directly.
