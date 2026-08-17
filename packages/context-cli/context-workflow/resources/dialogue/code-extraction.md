---
id: dialogue.code-extraction
kind: procedure
mediaType: text/markdown
---

# Code-extraction dialogue

Describe the proposed code scope before SDK fields. State:

- the confirmed repository module;
- which files are included;
- whether extraction follows configured/public entries or scans all matched
  files;
- whether internal symbols are included; and
- that the first run or later deltas produce Review candidates rather than
  approved Markdown.

If a selected package lacks a standard entry, offer two Context-owned choices:
configure source-relative API roots, or use scan mode for all declarations in
the confirmed file scope. Do not ask the user to change source code or package
metadata to satisfy Context.

Run the route-selected dry-run first. Report discovered, AST-analyzed, skipped,
symbol, relation, and candidate counts separately, plus resolved entries,
exported/internal counts, symbol-kind counts, and the proposed knowledge tree.
Treat those fields as structural scope evidence, not a semantic ranking. Stop
when the preview crosses the confirmed module boundary or the module
identity/path shape is wrong.

For a multi-module round, finish every pending extraction target before opening
one Review. For an unchanged repeat run, explain that no added, changed, or
removed symbols need a decision. Mention `extractTs`, `include`, `entries`,
`mode`, or `exportedOnly` only in technical configuration detail.
