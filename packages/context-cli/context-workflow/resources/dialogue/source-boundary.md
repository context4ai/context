---
id: dialogue.source-boundary
kind: procedure
mediaType: text/markdown
---

# Source-boundary dialogue

Describe the boundary in user terms before showing a registration command. For
code, distinguish a whole repository/subspace from one concrete package or
subdirectory. For documents, distinguish one file, a local document directory,
a documentation site, and a remote document.

Explain the observable impact:

- the date is one capture batch;
- every confirmed source is a module inside that batch;
- several code and document modules may share the date;
- `date/module` appears in source refs and phase ids; and
- stable codegraph knowledge paths use the module name without the date.

Do not invent `-A`, `-B`, or sequence suffixes. If today's batch exists, append
the newly confirmed module to it.

When inspection finds several package boundaries, show their paths and ask
which concrete boundaries should become sources. Explain that `include`
filters files inside a source and cannot select a monorepo package. Only after
the choice is explicit should the Agent use the route-selected registration
schema and command.
