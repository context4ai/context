# Context SDK Docs

These docs ship inside the installed SDK package at:

```text
node_modules/@c4a/context/docs/
```

For lifecycle work, Agents should first consume the resources selected by
`context status --format json` `workflow.current`. Read these SDK manuals when
the selected route requires project configuration, package templates, or
general reference; do not preload the whole manual set.

## Read First

- [Getting Started](./getting-started.md) — end-to-end component-library flow.
- [Agent Guide](./guides/agent-guide.md) — what an agent should do, and what it should not inspect manually.
- [Agent Dialogue](./guides/agent-dialogue.md) — stable dialogue principles and how route-selected gate resources are discovered.
- [Package Outputs](./guides/package-outputs.md) — how to choose between an agent knowledge-base package, LLM text, or no package output.
- [Lark Resource Materialization](./guides/lark-resources.md) — how embedded resources move from source evidence to approved knowledge and package assets.
- [Project API](./reference/project-api.md) — `defineProject`, sources, phases, review, and packages.
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
