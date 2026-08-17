---
id: procedure.verify-and-repair
kind: procedure
mediaType: text/markdown
---

# Verify and repair

Verification failures are grouped by root cause. Read the current diagnostic
resource before changing anything.

If approved Markdown is valid and only the deterministic structure projection
is stale, the legal repair is `context close --format json`. Otherwise, repair
the source-bound candidate or project declaration named by the root diagnostic,
then run verification again.

When every blocking finding is an approved document `source_ref` drift or an
unresolved required-resource placeholder, and each affected source already has
a declared pending structure target, the current prose align/compile round is
the repair path. Continue that Route before running verification again. This
exception does not apply to missing sources, malformed approved knowledge,
unrelated verification errors, or findings without a matching pending target.

When a complete replacement candidate batch is ready for Review, stable prose
candidate ids may intentionally match their currently approved pages. Review
that batch before deterministic close and final verification; the pending
replacement is not an approved-identity conflict.

Do not delete candidates, approved pages, snapshots, or structure slots to make
verification pass. Derived diagnostics should not be handled as independent
root failures.
