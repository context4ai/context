# Context SDK Docs

[简体中文](./README.zh-CN.md)

These docs ship inside the installed SDK package at:

```text
node_modules/@c4a/context/docs/
```

These manuals explain how a knowledge project declares sources, processing,
review, and package output. They are references inside the larger Agent-driven
workflow, not a second set of lifecycle instructions.

For active knowledge production, start through the installed Context Agent
entry. Agents should first consume the resources selected by
`workflow.current`, then read an SDK manual only when that Route requires
project configuration, package-template work, or a stable API reference. Do not
preload the whole manual set.

## Find the right document

| Current need | Read |
|---|---|
| Understand the whole knowledge-project shape | [Getting Started](./getting-started.md) |
| Know what the Agent may decide or change | [Agent Guide](./guides/agent-guide.md) and [Agent Dialogue](./guides/agent-dialogue.md) |
| Configure sources, phases, review, or packages | [Project API](./reference/project-api.md) |
| Author or inspect an Indexer Provider protocol | [Indexer Provider Protocol](./reference/indexer-provider-protocol.md) |
| Select or customize an Indexer Provider | [Provider Selection and Customization](./guides/indexer-provider-and-customization.md) |
| Author a Code or Markdown Indexer Skill | [Code Indexer Authoring](./guides/code-indexer-skill-authoring.md) and [Markdown Indexer Authoring](./guides/markdown-indexer-skill-authoring.md) |
| Choose a code extraction path | [Code Extractor Selection](./reference/code-extractors.md) |
| Choose an Agent package or LLM document | [Package Outputs](./guides/package-outputs.md) |
| Customize package files and indexes | [Package Templates](./reference/package-templates.md) and [Template Variables](./reference/template-variables.md) |
| Preserve Lark images and embedded resources | [Lark Resource Materialization](./guides/lark-resources.md) |

## Complete reference

- [Getting Started](./getting-started.md) — end-to-end component-library flow.
- [Agent Guide](./guides/agent-guide.md) — what an agent should do, and what it should not inspect manually.
- [Agent Dialogue](./guides/agent-dialogue.md) — stable dialogue principles and how route-selected gate resources are discovered.
- [Package Outputs](./guides/package-outputs.md) — how to choose between an agent knowledge-base package, LLM text, or no package output.
- [Lark Resource Materialization](./guides/lark-resources.md) — how embedded resources move from source evidence to approved knowledge and package assets.
- [Project API](./reference/project-api.md) — `defineProject`, sources, phases, review, and packages.
- [Indexer Provider Protocol](./reference/indexer-provider-protocol.md) — manifest, controlled execution, detector/inspector I/O, customization, and staged project apply.
- [Provider Selection and Customization](./guides/indexer-provider-and-customization.md) — registry-only selection, the six-level customization ladder, upgrade conflicts, debugging, and completion conditions.
- [Code Indexer Authoring](./guides/code-indexer-skill-authoring.md) — the 23-point Provider Skill release contract and anonymous fixture expectations.
- [Markdown Indexer Authoring](./guides/markdown-indexer-skill-authoring.md) — capture/semantic boundaries, Section placement, material answers, editorial policy, and local incremental behavior.
- [Code Extractor Selection](./reference/code-extractors.md) — inspect module technology signals and choose a built-in extractor, reusable structural package, or project adapter.
- [Package Templates](./reference/package-templates.md) — `kbPackage`, `llmsPackage`, template variables, and examples.
- [Template Variables](./reference/template-variables.md) — Handlebars variables, loops, comments, and default knowledge inventories.

Approved Markdown follows the complete Context production profile. Package
knowledge pages use a smaller consumer projection containing only reader-facing
metadata and content. Node identity, provenance, section evidence, review
fingerprints, symbol lists, generated-child records, and relationships remain in
the production workspace or `context-build-inventory.json`. The inventory maps
each distributed path back to its approved knowledge path. The kb package root may contain agent files; the
OKF-compatible surface is its selected `wikis/`, `guides/`, `rules/`, and
`feats/` subtrees.

## Installed Templates

Template examples ship in:

```text
node_modules/@c4a/context/templates/package-templates/
```

Copy or mirror these into a workspace under `src/package-templates/` when the
project needs package outputs.

Long-lived multi-source production workspaces may also start from the optional
project-maintenance Skill template at:

```text
node_modules/@c4a/context/templates/project-skills/maintain-project-knowledge/SKILL.md
```

Copy it into the project's `.agents/skills/`, rename it for the project, and
replace its project-fact and impact-map sections. It is a project adapter; it is
not included in a built knowledge package and does not replace the installed
Context Skill.
