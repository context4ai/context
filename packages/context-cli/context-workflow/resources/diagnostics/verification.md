---
id: diagnostic.verification
kind: diagnostic
mediaType: text/markdown
---

# Verification diagnostics

Context reports one root diagnostic with counts and keeps derived findings in a
separate detail view. Codes are stable machine identifiers; this document gives
the shared recovery boundary.

Content or provenance failures require a new source-bound candidate or an
explicit evidence-maintenance decision. Projection-only failures can be
repaired by deterministic close. A warning does not become success by being
omitted from output.

`approved-source-orphaned` is a persistent warning produced only after an
explicit `keep-orphaned` decision. It records that the page remains usable by
policy while its original source document cannot be resolved. It does not
permit changed source content to bypass replacement Review.
