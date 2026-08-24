# Document revisions

Document optimization is an optional build phase for source-backed prose. It
repairs presentation-level Markdown without changing the approved knowledge
page.

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
pages receive a full revision beside their approved page:

```text
knowledge/guides/setup.md
knowledge/guides/setup__revision.md
```

The `__revision.md` suffix is reserved. Default knowledge discovery, structure,
search, and package selection exclude revision files. Validation and build
associate a revision with its sibling base page and apply it under the original
package path. A revision stores only the base digest that cannot be inferred;
its path and revised fragments are derived. Unchanged fragments inside a full
revision are inferred. A page with no changes stores only one derived negative
cache key below `.tmp/context-runtime/document-optimization/`; replacement
prose and fragment metadata are not duplicated there.

After capture, review, or build, a user may ask conversationally to correct one
existing knowledge page. Start the correction by title, approved path, or
ViewRef:

```bash
context revise "<title, approved path, or ViewRef>" --format json
```

Context starts `route.document-revision.requested` only after resolving one
page. Ambiguous requests return candidates instead of guessing. Edit
reader-visible prose without changing provenance or `context:section`
boundaries, then run `context optimize-docs validate`. A valid correction ends
the request and the next Route offers a package build when output is stale. If
broad document optimization was disabled, this entry activates only the target
page and keeps every other eligible page out of the pending batch. If upstream
content changes, the revision becomes a conflict and must be reviewed again.

Disable and restore baseline output with:

```bash
context optimize-docs disable
```

Revision pages move to Context runtime recovery storage, and the next build
uses approved knowledge directly.
