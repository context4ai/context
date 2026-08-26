# Document revisions

New workspaces enable source-constrained editorial revision by default. It is a
build phase for source-backed prose that improves publication value and
readability without changing the approved knowledge page or inventing facts.

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

When enabled, the workflow plans only new or changed source Sections. For each
Section the CLI reports mechanical signals and allowed actions. The Agent may
keep it, repair local presentation, reshape it within the same source boundary,
or omit it when the CLI confirms a non-knowledge reason. Only changed pages
receive a full revision beside their approved page:

Signals are review leads rather than a complete readability verdict. The Agent
must read every Section. Keeping a signaled Section requires a concrete,
decision-only assessment explaining why each signal is a false positive or why
editing would reduce source fidelity. The assessment names every reported
signal code so the CLI can verify complete coverage; it is never published.
Time, cost, workload, batch size, or delivery pressure are not valid keep or
defer reasons. Fully managed operation applies all safe repairs, reshapes, and
eligible omissions autonomously; only genuinely unavailable semantic input is
batched for the user. A large fragment set must meet the same quality standard
as a single fragment.

```text
knowledge/guides/setup.md
knowledge/guides/setup__revision.md
```

The `__revision.md` suffix is reserved. Default knowledge discovery, structure,
search, and package selection exclude revision files. Validation and build
associate a revision with its sibling base page and apply it under the original
package path. A revision stores only the base digest that cannot be inferred;
its path and revised Sections are derived. Unchanged Sections inside a full
revision are inferred. A page with no changes stores only one derived negative
cache key below `.tmp/context-runtime/document-optimization/`; replacement
prose and Section metadata are not duplicated there.

Typical repair candidates are Markdown syntax, spacing, empty table rows, and
descriptive labels for links whose purpose is already present. Reshape handles
wide tables, long cells, mixed images and links, or long prose by creating a
clearer structure inside the same Section. Unanswered question sets, empty
placeholders, decision-free drafts, duplicates, and obsolete-only Sections may
be omitted. Questions with answers, limitations with an action, and
deprecations with a replacement remain knowledge. Link targets, images, code,
commands, numbers, identifiers, conditions, and source references are protected
through validation. Ambiguous currency, ownership, or sensitive values appear
together in the plan's `input_requests` and require one batched user decision.

After capture, review, or build, a user may ask conversationally to correct one
existing knowledge page. Start the correction by title, approved path, or
ViewRef:

```bash
context revise "<title, approved path, or ViewRef>" --format json
```

Context starts `route.document-revision.requested` only after resolving one
page. Ambiguous requests return candidates instead of guessing. Edit
reader-visible prose within existing `context:section` boundaries without
changing provenance or protected values, then run `context optimize-docs
validate`. A valid correction ends
the request and the next Route offers a package build when output is stale. If
broad document optimization was disabled, this entry activates only the target
page and keeps every other eligible page out of the pending batch. If upstream
content changes, the revision becomes a conflict and must be reviewed again.

Disabling moves active revision pages to Context runtime recovery storage. The
next build uses approved knowledge directly.
