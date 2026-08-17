---
id: dialogue.structure-confirmation
kind: procedure
mediaType: text/markdown
---

# Structure-confirmation dialogue

Present the staged structure as a proposal, not as approved knowledge. Explain
that confirmation freezes the current round's:

- knowledge pages and paths;
- section ownership and source spans;
- source-backed relationships; and
- compile order.

The final staged HTML report is the confirmation surface. Open it when the CLI
returns it, report whether opening succeeded, and provide the file URL/path when
it did not. Do not confirm from counts alone.

Present these three outcomes in the user's language:

- confirm the current staged structure digest;
- revise the proposed structure and validate/stage it again; or
- return to the source boundary when the current evidence scope is wrong.

If staging changed the structure digest, any earlier confirmation no longer
applies. When `workflow.current.gate.resolution` is `user`, explain the change
and obtain a new confirmation. When it is `session-authority`, inspect the same
report and continue without asking again. After resolution, execute only the
revision-bound command returned by `workflow.current`; never construct or reuse
a phase-local confirmation command.

Deterministic boundary repairs are internal CLI maintenance and are not
separate approval rounds. If `workflow.current.gate.resolution` is
`session-authority`, inspect the final staged report and execute the returned
resolution command without asking the user again. Otherwise ask for one final
confirmation of the staged digest. Ask an earlier design question only when
evidence supports multiple incompatible structures, and say clearly that it is
not the final confirmation.

One source document may map to one page, but that is still an ordinary
structure proposal. A multi-source round confirms each source/collection slot;
do not confuse one slot with completion of the entire document batch.
