---
id: dialogue.package-output
kind: procedure
mediaType: text/markdown
---

# Package-output dialogue

Explain output shapes before SDK factory names. Offer:

- an Agent knowledge-base package with `AGENTS.md`, a knowledge-query Skill,
  approved OKF roots, and adaptive indexes;
- one LLM text bundle for model context or RAG import; or
- no package yet, leaving approved Markdown in `knowledge/`.

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

Do not offer a hidden `both` shortcut. If the user wants multiple outputs,
declare and inspect one first, then obtain confirmation for the next. Mention
`kbPackage` and `llmsPackage` only after the semantic output choice.
