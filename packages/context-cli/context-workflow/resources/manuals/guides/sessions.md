---
id: context.sdk.sessions
kind: procedure
mediaType: text/markdown
---

# Prepare a conversation-summary source

Use sessions for a bounded summary formed from an authorized conversation:
requirements, design, troubleshooting, operational or general knowledge.
Code association is optional. An Agent or external supplier prepares the summary
before import. Do not scan host history, ingest the full transcript, invent a
conversation from a diff, or move an unrelated conversation into note merely
because it lacks a commit.

Keep the problem, confirmed decisions, useful reasons, constraints and open
questions. Remove repetitive turns, tool logs and abandoned attempts unless they
explain a current limit. Preserve whether each statement was proposed, agreed,
implemented or verified. If only a supplied summary is available, say so; do not
claim to have read the original. Do not make up speakers, dates or approval.
A session with no reusable information can remain outside the workspace.

Save through `context source import --input <file> --format json`, using
`type: sessions`, `name: YYYYMMDD/topic.md` and the prepared `markdown` string.
Choose the actual conversation date, or collection date if unknown, and retain
the same path for corrections. The summary needs no mandatory body headings.

Optional `changes` associates one or several code changes. Each row accepts
`commit` (full 40/64 hexadecimal Git SHA), `mr` (HTTP(S) MR/PR URL), and optional
`repository`. At least commit or mr is needed per row; omit the entire field
for unrelated sessions. Use actual known identifiers, never fabricated hashes.
A reference does not prove merge, deployment, tests or authorize fetching code.
The CLI stores this field in the source's YAML frontmatter, discovers it from
that same file, and does not introduce a sidecar or separate registry.

For example, an import may have `changes: [{mr: "https://git.example.org/team/project/merge_requests/42"}]`.
This is an illustrative URL, not a lookup target. The same payload without
changes imports an independent requirements discussion normally. Use the current
base_digest to change text or associations; explicit `changes: []` clears the
associations. Omission leaves the source's inline changes intact. When replacing
only the summary body, preserve existing associations unless explicitly removed.
Do not duplicate commit/MR fields into knowledge frontmatter.

Saving alone does not start indexing. Select a compatible Sessions Provider for
an independent reader topic, or keep an existing page's Code/Markdown primary
and include the summary in its authorized evidence/read scope. If specialized
interpretation is needed, explicitly select an extension from the Sessions or
business Provider. Knowledge turns useful conclusions into answers, explanations
and procedures, not a meeting recap. Existing structure.yaml source references
connect each relevant page/section to the saved summary and its optional changes.

Correct a faulty summary through source import with current base_digest and task
adjustment for pinned inputs. If the summary is accurate but the page is wrong,
revise the approved page. A new topic goes through structure review then normal
Author/Review. Neither knowledge approval nor source storage approves an upstream
change. A failed update retains source and approved knowledge for recovery.
