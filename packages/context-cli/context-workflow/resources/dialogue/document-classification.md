---
id: dialogue.document-classification
kind: procedure
mediaType: text/markdown
---

# Document-classification dialogue

Do not recommend a collection before reading the collection-neutral evidence
view and every required source-body resource. Summarize the observed document
shape, explain one evidence-backed
recommendation, and describe its package root:

| Collection | Use when the evidence primarily represents | Package root |
|---|---|---|
| `business` | business domains, actors, objects, and non-technical domain knowledge | `wikis/` |
| `product` | requirements, user behavior, user stories, and acceptance intent | `wikis/` |
| `architecture` | system structure, module design, technical mechanisms, and platform/tooling design | `guides/` |
| `sop` | procedures, runbooks, operations, maintenance, and troubleshooting steps | `guides/` |
| `faq` | question-and-answer material intended for issue-oriented retrieval | `guides/` |
| `standards` | normative rules, constraints, checklists, and quality/compliance requirements | `rules/` |
| `decision` | explicit alternatives, selected choices, trade-offs, and decision records | `guides/` |
| `incident` | incident timelines, impact, causes, response, and prevention | `guides/` |
| `test` | test plans, validation scenarios, matrices, and acceptance cases | `rules/` |

`codeindex` comes from code extraction and `feats` is not a document mainline
collection. Filenames, URLs, titles, and example collection names are
insufficient evidence.

Ask the user to confirm exactly one mainline collection for the current source,
unless session-managed authority resolves this gate. After confirmation,
declare the complete align, compile, and Review lifecycle for the same source
and collection, then re-evaluate because other captured targets may remain.
