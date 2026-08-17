---
id: diagnostic.workspace-state
kind: diagnostic
mediaType: text/markdown
---

# Invalid workspace state

This route means Context could observe the workspace but could not prove a
legal lifecycle action from its facts.

Read the root diagnostics and their structured details. Repair the named
project declaration or missing lifecycle artifact. Do not rerun completed
phases, edit generated `knowledge/structure.yaml`, or delete runtime state as a
shortcut.

If the diagnostic reports a route/fact conflict, preserve the status output and
stop lifecycle writes until the conflict is resolved.

`diagnostic.compile-route-ambiguous` means project declarations assign more
than one compile phase to the same source and collection. Make that ownership
unique in `src/index.ts`; verification cannot choose one for you.

`diagnostic.structure-snapshot-missing` means a persisted compile batch names a
confirmed structure digest whose snapshot is absent. Restore that snapshot, or
declare and confirm a new structure round for the affected source and
collection. Do not edit digest fields to silence the diagnostic.
