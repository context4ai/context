---
id: procedure.prose-compile
kind: procedure
mediaType: text/markdown
---

# Source-bound prose compilation

Compile materializes review candidates from confirmed structure and source
evidence. It never writes directly to approved knowledge.

The CLI derives this projection mechanically from the confirmed section ids,
kinds, and source spans. Run only the revision-bound compile command returned
by the current Route. Do not create compile-action payloads or rewrite source
content.

One compile command validates every owned view first, then atomically
materializes the source/collection candidate batch. In an explicitly managed
conversation, the host loop may continue across the remaining deterministic
compile slots after this procedure has been read; it re-evaluates revision and
validation state after every write. The current structure view is optional
inspection context because the CLI consumes the confirmed structure directly.
Do not open a partial Review while planned views remain.
