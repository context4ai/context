---
id: dialogue.human-gates
kind: procedure
mediaType: text/markdown
---

# Human-gate dialogue

Explain the user decision before implementation detail. State:

- what is being decided;
- what changes after confirmation;
- which source boundary, knowledge shape, or output is affected; and
- which meaningful alternatives exist.

Use the user's conversation language. Keep commands, paths, ids, status values,
payload keys, and `source_ref` values exact.

When two or three fixed choices exist, prefer the host's native choice UI. If
none is available, present concise A/B/C choices with one impact sentence each.
Labels must describe user outcomes, not SDK factories or internal route names.
Do not start with raw TypeScript, placeholder commands, `alignProse`,
`compileProse`, `reviewValidity`, `kbPackage`, or `llmsPackage`.

An explicit fully managed request in the current conversation resolves only
delegatable gates. Use the returned managed route without asking those
questions again. Managed authority is not project state: never persist it,
reuse it in another conversation, use it to choose a source boundary, authorize
an unread external source, approve an external operation, or hide validation
and verification failures.

Keep transition reports short: what changed, the current state, and the next
decision or action. Do not paste a raw CLI transcript unless the user requests
it.
