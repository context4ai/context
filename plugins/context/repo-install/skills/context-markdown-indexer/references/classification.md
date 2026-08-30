# Section classification and projection intent

Classify evidence at Section granularity. A profile describes the source family;
it does not force one whole document into one reader purpose. For every emitted
Section, choose the semantic `document_kind`, `reader_goal`, and
`artifact_kind` before grouping Sections into Artifacts.

Use body evidence, source authority, audience, and the reader task. File names,
URLs, headings, navigation labels, and the selected profile are hints, not proof
that every Section has the same intent. Do not infer authority from polished
language or an official-looking path.

## Canonical projection vocabulary

The current community Markdown profiles use the following semantic intents.
The CLI profile contract owns their stable storage projection; this table does
not authorize a collection or output path.

| Profile or Section family | Use when the evidence primarily… | `document_kind` | `reader_goal` | `artifact_kind` |
| --- | --- | --- | --- | --- |
| `domain-reference` | defines a durable domain, vocabulary, boundary, or business concept | `domain-reference` | `understand-domain` | `content` |
| `product-requirements` | states product intent, behavior, scope, actors, or acceptance needs | `product-requirements` | `understand-product-intent` | `content` |
| `technical-guide` | explains architecture, runtime behavior, interfaces, or design constraints | `technical-guide` | `understand-technical-design` | `content` |
| user/developer product guidance | explains a user-visible capability or product behavior | `product-requirements` | `understand-product-intent` | `content` |
| user/developer technical guidance | explains implementation-facing design or integration context | `technical-guide` | `understand-technical-design` | `content` |
| user/developer task guidance | gives a repeatable task, setup, operation, or troubleshooting sequence | `task-guide` | `complete-reader-task` | `content` |
| public API contract | supports lookup of public operations, fields, compatibility, or examples | `public-api-reference` | `look-up-public-contract` | `content` |
| public contract policy | states normative compatibility or usage constraints around a public contract | `public-contract-policy` | `follow-public-contract-policy` | `content` |
| `runbook` | directs operation, diagnosis, mitigation, recovery, or rollback | `runbook` | `operate-or-recover-system` | `content` |
| `faq-support` | answers a durable reader question with reusable evidence | `faq-support` | `resolve-reader-question` | `content` |
| `standard-policy` | defines a stable rule, standard, policy, or compliance boundary | `standard-policy` | `follow-standard-or-policy` | `content` |
| `decision-record` | records alternatives, a choice, rationale, and consequences | `decision-record` | `understand-decision-and-tradeoffs` | `content` |
| `incident-review` | records impact, timeline, cause, response, and follow-up learning | `incident-review` | `learn-from-incident` | `content` |
| `test-validation` | defines or reports verification, acceptance, or observed results | `test-validation` | `verify-behavior-or-acceptance` | `content` |
| release explanation | explains what changed, compatibility, or release impact | `release-guide` | `understand-release-change` | `content` |
| migration procedure | tells a reader how to migrate, verify, and recover | `migration-guide` | `complete-migration` | `content` |

`documentation-site` is an umbrella router. Apply the matching row above to
each source-backed Section; do not invent a site-wide projection intent and do
not collapse a multi-document site to one classification.

## Classification order

1. Establish the Section's current source authority and audience from the
   authorized evidence view.
2. State the concrete question the Section enables a reader to answer or task
   it enables them to complete.
3. Choose the narrowest matching `document_kind` and `reader_goal` pair from
   the current profile contract.
4. Use `artifact_kind: content` for the current community Markdown Bundle. Do
   not invent a specialized Artifact kind unless the supplied profile contract
   explicitly registers it.
5. Return the intent on every actual or template-projected Section. Do not put
   a collection, directory, filename, or package root in the Result.

When a Section mixes multiple reader tasks, split it along continuous evidence
boundaries. Keep one Section only when the material forms one coherent answer
for one reader goal. A heading change alone does not require a split, and a
shared heading does not justify combining unrelated tasks.

If no registered intent fits, return a material/capability disposition instead
of selecting the nearest label. Unsupported or authority-ambiguous material
must not become a reader Artifact.
