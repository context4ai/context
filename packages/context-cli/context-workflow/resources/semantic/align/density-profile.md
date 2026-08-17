---
id: context.semantic.align.density-profile
kind: procedure
media-type: text/markdown
applies-to:
  - coverage
  - reading_density
  - structure
---

# Evidence Density Selection
<!-- Context workflow semantic resource. -->

Use density as a private reading and section-planning strategy. It is not a
separate payload, not a quality score, and not a workflow stage. Persist only
current `context.structure.v1` fields such as `nodes[]`, `sections[]`,
`source_refs[]`, `edges[]`, and `unresolved[]`.

Apply this reference when a captured source is long, dense, fragmented, or hard
to split into stable planned sections. Use the current CLI evidence views
(`read-plan`, `source-index`, `span-detail`, `span-text`) to inspect material;
do not invent a separate coarse-read artifact.

| Profile | Use When | Agent Behavior |
|---|---|---|
| `macro` | A long source has many headings, sections, or broad topic shifts. | Create section proposals around major headings and preserve document-level anchors so later passes do not flatten scope. |
| `meso` | Default for normal product, design, or operational documents with several related sections. | Produce section proposals for meaningful local units and preserve evidence anchors. |
| `micro` | The source is fragmented, note-like, or dense with short independent claims. | Keep section proposals narrow and avoid bundling unrelated blocks into one candidate. |
| `single_pass` | The source is short enough that one read can safely discover all relevant structure. | Keep anchors minimal and avoid over-segmentation, but still validate the resulting structure. |

Treat Markdown heading changes as section-planning hints, not hard boundaries.
Sibling sub-headings under a shared parent can remain in one planned section
when they form one coherent semantic topic for that parent. Headings with no
shared parent should usually split unless you intentionally want one section to
span them. When a dense source has many headings, split by heading first, then
merge adjacent or sibling groups only when the merged section is still one
coherent fact group.

Do not let density alone choose `node_type`, `tags`, `section.kind`, or body
content. Action/domain gates are decided from source evidence and the current
schema, not from density metadata.
