---
name: record-workspace-version
description: Record the completed Context knowledge iteration when the workspace Route selects this action.
---

Run `context version inspect --format json`. Read the changed formal files and
the current conversation to write a concise reader-facing changelog. The CLI
checks real changes and an increasing SemVer; you decide the wording and impact.
Do not summarize temporary execution progress as knowledge changes.

This action is selected at completed-scope delivery, after Review, Close and
package configuration/template approval, before the final package build.
Record one version for the completed scope, then follow the returned workspace
Route to build outputs with that version. A failed build alone does not require
another version; retry through the Route using the recorded version. Do not
record a version for each intermediate batch or worker result.

Keep each version's details within 1500 visible characters total, including
punctuation across title, changes, trigger descriptions and actor display name;
exclude protocol keys, version and date. Before submitting, compress longer
entries by merging related changes and removing repeated execution narration.
Retain the main changes, impact and actual triggers. Do not truncate text blindly
or split one iteration into extra versions to evade the limit.

Use the returned digest in `context version record --input <file> --format json`.
Input fields: `expected_digest`, `version`, `title`, `changes` (nonempty list),
`triggers` (nonempty list of `{kind, description}`), and optional
`actor: {name, kind}`. Trigger kinds are initial, note, sessions, mr, module,
document, navigation, repair, dist, other. Describe what actually triggered the
iteration, not merely the CLI command. Never include raw private transcripts,
credentials, local absolute paths or private account IDs in public history.

Increment minor for added modules/material that expands knowledge coverage;
increment patch for repairs, existing-module updates, navigation or persistent
work-status changes. Major increases require an explicit user instruction.
Start at 0.1.0 unless the workspace already has a higher version or the user
specifies one. One completed scope receives one version, not one per worker.

Use a Lark user's display name only when explicitly known from the conversation
(`kind: lark`); otherwise omit actor and let the CLI use Git user.name. Do not
look up accounts just for attribution. No identity is preferable to guessing.
Only the coordinator records the version. Consume the returned `workflow.current`
directly; refresh status only when the response has no Route or configuration changed.
In managed mode resume `context run --managed --until blocked-or-complete --format json`
for mechanical execution. Recording a
version does not authorize a commit, tag, upload or deployment.
