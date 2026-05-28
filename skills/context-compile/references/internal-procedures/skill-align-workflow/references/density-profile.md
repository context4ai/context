# Coarse Read Density Selection

Use `density_profile` in `align-coarse-read` to describe how much structure the document needs before candidate discovery. This is a reading strategy, not a quality score.

This reference applies only when the current envelope asks for `next_action.kind: "submit_coarse_read"`. In normal direct routes, read-plan/source-bundle already selected the evidence path; do not emit a `single_pass` coarse-read payload unless the CLI requested coarse-read.

| Profile | Use When | Agent Behavior |
|---|---|---|
| `macro` | A long source has many headings, sections, or broad topic shifts. | Create section proposals around major headings and preserve document-level anchors so later passes do not flatten scope. |
| `meso` | Default for normal product, design, or operational documents with several related sections. | Produce section proposals for meaningful local units and neutral content signals for each anchor. |
| `micro` | The source is fragmented, note-like, or dense with short independent claims. | Keep section proposals narrow and avoid bundling unrelated blocks into one candidate. |
| `single_pass` | The source is short enough that one read can safely discover all relevant structure. | Still emit the `align-coarse-read` artifact, but keep anchors minimal and avoid over-segmentation. |

Treat Markdown heading changes as section-planning hints, not hard boundaries. Sibling sub-headings under a shared parent can remain in one `section_groups[]` entry when they form one coherent semantic topic for that parent. Headings with no shared parent should usually split unless you intentionally want one Section to span them. When a dense source has many headings, split by heading first, then merge adjacent or sibling groups only when the merged Section is still one coherent fact group.

## Content Signals

`content_signals` are neutral shape signals used later by action/domain gates. They must not directly claim `node_type`, tags, or recommendations.

| Signal | Meaning |
|---|---|
| `temporal_density` | The text has timelines, phases, schedules, version changes, or ordered time references. |
| `actor_density` | The text names roles, users, teams, systems, services, or operators that perform work. |
| `step_density` | The text contains ordered steps, procedures, phases, checklists, or how-to flow. |
| `directive_density` | The text contains imperatives, policies, constraints, must/should language, or runbook-like instructions. |

Use only `high`, `med`, or `low` based on the local section text. The canonical middle value is `med`; do not write `medium`. High `step_density` plus explicit actors and outcomes is useful evidence for an Action Gate, but it is not enough by itself to emit an `action` Node.
