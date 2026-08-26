---
id: procedure.close-and-build
kind: procedure
mediaType: text/markdown
---

# Close and build

Close deterministically reconciles approved Markdown, existing durable machine
metadata, and confirmed structure snapshots into `knowledge/structure.yaml`.
It then compacts repeated machine fields out of each Markdown page and validates
the hydrated result. When an approved page still points at a captured source asset,
close may mechanically replace that target with its content-addressed
`knowledge/assets` path; it does not rewrite reader-visible prose. Before
removing the transient snapshots, it retains only each closed prose target's
source, collection, and consumed snapshot hash under `source_inputs`.

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
# Code-index audit record

When a package selects approved `codeindex` pages, build requires the current
batch-level Agent audit to be accepted. The complete report and decision state
are runtime data below `.tmp/context-runtime/code-index-audit/`; deleting
`.tmp/` causes Context to recompute and re-audit them. They are not copied into
`dist/`, uploaded with the package, or committed as knowledge. The package
inventory stores only the report digest, decision, and compact summary needed
to identify the audited build.
