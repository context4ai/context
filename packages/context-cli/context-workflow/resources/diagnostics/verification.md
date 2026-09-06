---
id: diagnostic.verification
kind: diagnostic
mediaType: text/markdown
---

# Verification diagnostics

Context reports one root diagnostic with counts and keeps derived findings in a
separate detail view. Codes are stable machine identifiers; this document gives
the shared recovery boundary.

Broken source references or invalid stored structure require a corrected
candidate or an explicit evidence-maintenance decision. Projection-only
failures can be repaired by deterministic close. Content-quality suggestions,
including suspected unfilled placeholders, are advisory: they do not change a
successful CLI outcome or add a gate. The existing Agent or user Review decides
whether the content needs revision.

`approved-source-orphaned` is a persistent warning produced only after an
explicit `keep-orphaned` decision. It records that the page remains usable by
policy while its original source document cannot be resolved. It does not
permit changed source content to bypass replacement Review.
