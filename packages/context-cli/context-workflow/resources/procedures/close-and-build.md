---
id: procedure.close-and-build
kind: procedure
mediaType: text/markdown
---

# Close and build

Close deterministically reconciles approved Markdown and current relationship
inputs into `knowledge/structure.yaml`. It compacts repeated machine fields out
of each Markdown page and validates the hydrated result. When an approved page
still points at a captured source asset, close may mechanically replace that
target with its content-addressed `knowledge/assets` path; it does not rewrite
reader-visible prose. Candidate fingerprints, Section mappings, old prose
`source_inputs`, and Review receipts remain outside long-lived knowledge.

Do not hand-edit, duplicate, or move fields between Markdown and
`structure.yaml`. The CLI owns compaction and hydration. A compact Markdown page
remains readable and keeps enough identity for projection diagnostics; complete
code and optimization metadata is intentionally not duplicated.

Build runs only after close and verification are current. It writes declared
packages under `dist/` and records an inventory receipt with added, updated,
removed, and index changes.

When document optimization is enabled, its current revision batch must also be
resolved before build. Build compiles each approved page through its optional
`__revision.md` sidecar and records the policy and decision counts in the
package inventory. Revision sidecars are never emitted as separate knowledge.

Run only the current route command, then evaluate again. A successful build
means the currently declared scope is current; newly captured or newly declared
targets can reopen earlier graph nodes.

The final completion summary must cover the built outputs, validation status,
knowledge scale, and unresolved issues. Add a compact `Review reports` section with every
exact HTML report URL or local report path that the user actually used for a
review decision in this conversation, together with its reviewed scope. Omit
the section when no report was user-reviewed. Do not reconstruct it by scanning
`.tmp`, invent a shareable URL, or classify fully managed or force approval as
user review.
