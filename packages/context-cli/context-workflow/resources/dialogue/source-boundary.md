---
id: dialogue.source-boundary
kind: procedure
mediaType: text/markdown
---

# Source-boundary dialogue

For the first production task in a new workspace, use the required work-start
procedure before presenting this source registration action. Read a supplied
plan as task guidance, read batch metadata titles under that procedure's limits and
10-document failure fallback (no bodies or outlines; retain URLs when titles are unavailable),
resolve every required start condition, present the report and wait for feedback.
Do not register the plan itself or begin capture merely because it contains source
paths. Once confirmed, include the report path required by the current input schema.

Describe the boundary in user terms before showing a registration command. For
code, distinguish a whole repository/subspace from one concrete package or
subdirectory. For documents, distinguish one file, a local document directory,
a documentation site, and a remote document.

For repo/file/lark registration, explain the observable impact:

- the date is one capture batch;
- every confirmed source is a module inside that batch;
- several code and document modules may share the date;
- `date/module` appears in source refs and phase ids; and
- stable codeindex knowledge paths use the module name without the date.

Do not invent `-A`, `-B`, or sequence suffixes. If today's batch exists, append
the newly confirmed module to it.

When the current request already lists exact local modules or documents, do not
repeat those source names as a separate question in either ordinary or fully managed
mode. Their presence does not by itself settle reader purpose, output language,
delivery choices or other required work-start information.
Resolve each named module to one unique existing local path inside the
user-scoped root, then pass that path in the batch payload. Repository paths are
relative to the Context project root; the CLI may mechanically read their Git
root, `origin`, and current commit. Ask only when a name is ambiguous, no
matching path exists, or selecting one match would broaden the requested scope.

When inspection finds several package boundaries, show their paths and ask
which concrete boundaries should become sources. Explain that `include`
filters files inside a source and cannot select a monorepo package. Only after
the choice is explicit should the Agent use the route-selected registration
schema and command.
