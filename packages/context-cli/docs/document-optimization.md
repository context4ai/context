# Document revisions

New workspaces enable conservative document optimization by default. It is a
build phase for source-backed prose that repairs presentation-level Markdown,
links, and obvious local errors without changing the approved knowledge page or
broadly rewriting its meaning.

To opt out during initialization:

```bash
context init context --no-optimize-docs
```

Existing workspaces retain their current setting. Change it explicitly with:

```bash
context optimize-docs enable
context optimize-docs disable
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

Disabling moves active revision pages to Context runtime recovery storage. The
next build uses approved knowledge directly.
