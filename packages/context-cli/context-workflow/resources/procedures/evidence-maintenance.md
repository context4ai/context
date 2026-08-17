---
id: procedure.evidence-maintenance
kind: procedure
mediaType: text/markdown
---

# Evidence maintenance

Approved knowledge can outlive a moved or temporarily unavailable source, but
the resulting evidence state must stay explicit.

- Re-pin only when the approved body still matches current source content and
  only the evidence location changed.
- Create a new candidate when source content changed.
- Deprecate knowledge that should no longer be used.
- Keep source-orphaned knowledge only after an explicit user decision and retain
  the evidence warning.

Use the affected `view_ref` values from the current diagnostic resource. Do not
target maintenance by guessed paths or node names.
