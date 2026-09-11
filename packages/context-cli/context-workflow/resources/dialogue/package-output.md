---
id: dialogue.package-output
kind: procedure
mediaType: text/markdown
---

# Package-output dialogue

Explain output shapes before SDK factory names. Offer:

- an Agent knowledge-base package with `AGENTS.md`, a knowledge-query Skill,
  approved OKF roots, and adaptive indexes;
- a searchable documentation website with the approved knowledge map, source cards and local-time update timestamps;
- one LLM text bundle for model context or RAG import.

These are multi-select channels, not exclusive options. For a new workspace with
no explicit preference, propose KB + website as the default in the work-start
report. Reuse that decision or session delegation at packaging; do not ask again
for each channel. Preserve an existing workspace's configured output choices.
A user can add a website later by asking to generate a documentation website.

The user may postpone packaging and keep the approved Markdown in `knowledge/`.
When a user decision is required by the current Route and no session authority exists, collect the choices together; postponing is not a
package declaration or a completed delivery. Do not write a `none` factory or
claim that `packages: []` records a finished output choice.

For the Agent knowledge-base package, show a compact tree and explain that
small directory contents are linked from the parent index while a directory
with more than the configured threshold gets its own child index. Templates
under `src/package-templates/` are editable presentation, not a second factual
source.

After the user chooses an Agent knowledge-base package, explain that its
knowledge roots are flat inside `dist/<package-name>/`; do not ask for a second
package namespace. Ask whether Skills need a short optional prefix, then
maintain their complete final names in the template. Do not expose downstream
layout terminology or ask for platform-specific identity fields.

Referenced resources are bundled by default. Explain the 1 MiB per-image and
40 MiB total-image package limits only when relevant. Offer Git raw links or
explicit omission only when the author asks for another delivery policy. Git
raw uses an immutable derived URL or an author-provided HTTPS `urlPrefix`;
publishing and access remain the author's responsibility.

Map KB + website to one `kbPackage` with `site` configured, and LLM text to an
additional `llmsPackage`. There is no `both` factory. If only a website is wanted,
explain that it is built alongside the KB and only the sibling `dist/<base>-site/` directory needs
to be distributed. The Agent makes the small SDK configuration edit; users do
not need to write webpage code. Do not add a separate confirmation per output.
