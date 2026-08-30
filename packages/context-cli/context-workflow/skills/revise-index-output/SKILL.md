---
name: revise-index-output
description: Revise one exact Indexer candidate set in response to a recorded runtime profile failure.
---

# Revise Index Output

Read the current profile audit and its failed metric samples. Change only the bound candidate revision; do not change source scope, requirements, baseline checks, metric thresholds, or provider authority.

Return `context.indexer.profile-revision-record-input/v1` with the new result fingerprint, a concrete list of actions taken, unresolved reasons, and the current ledger digest. A semantically unchanged fingerprint is not a new attempt.

After the third failed attempt, stop revising. The CLI must produce the complete failure report before any override is requested.
