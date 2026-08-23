---
id: procedure.close-and-build
kind: procedure
mediaType: text/markdown
---

# Close and build

Close deterministically derives `knowledge/structure.yaml` from approved
Markdown and the confirmed structure snapshots. It validates the rebuilt
projection. When an approved page still points at a captured source asset,
close may mechanically replace that target with its content-addressed
`knowledge/assets` path; it does not rewrite reader-visible prose. Before
removing the transient snapshots, it retains only each closed prose target's
source, collection, and consumed snapshot hash under `source_inputs`.

Build runs only after close and verification are current. It writes declared
packages under `dist/` and records an inventory receipt with added, updated,
removed, and index changes.

When document optimization is enabled, its current overlay batch must also be
resolved before build. Build projects approved knowledge through those overlays
without changing `knowledge/`, and records the overlay policy and decision
counts in the package inventory.

Run only the current route command, then evaluate again. A successful build
means the currently declared scope is current; newly captured or newly declared
targets can reopen earlier graph nodes.
