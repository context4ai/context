---
id: dialogue.repository-source-recovery
kind: procedure
mediaType: text/markdown
---

# Repository source recovery dialogue

Explain that the Context project is intact: only Git-ignored source checkouts
or local links are missing. Show one choice per physical repository, not per
logical module.

For an existing checkout, ask for its path or ask the user to authorize a
specific parent directory for a bounded scan. Show matching candidates with
their origin, HEAD, dirty state, and required subpath coverage before the user
selects one. Do not modify, switch, clean, or pull the selected checkout.

For a clone, show the registered remote, pinned commit, target directory, and
the logical modules that will share it. The clone restores the recorded source
version; it does not silently advance to the latest branch.

After recovery, summarize reused and cloned checkouts, actual commits, restored
module links, and any remaining permission or missing-subpath blockers.
