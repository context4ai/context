---
name: context-configure-indexer-providers
description: Build one path-free Context Indexer Provider selection from current requirements and visible Indexer Skills; use during the provider-selection Graph route, not for executing Providers or changing requirements.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: indexer
  agent-graph.entry: provider-selection
---

# Configure Indexer Providers

Read
`node_modules/@c4a/context/docs/guides/indexer-provider-and-customization.md`
for the registry-only default, Provider-layer rules, conflict handling and
completion conditions. This Action is the entry for
`indexer-provider-required`; when an exact distribution is unavailable, follow
the guide's `indexer-provider-unavailable` handling instead of substituting a
different version or cache.

The current Action input already contains the exact requirements and
CLI-bundled catalog. Report those bundled entries together with other Indexer
entry Skills already visible in this conversation. For an exact Skill root
already exposed by the Host, read only `SKILL.md` frontmatter and the sibling
`context-indexer.yaml`: the manifest version is authoritative and
`metadata.context-provider-version` must match it. Do not load Provider guidance
until selection. Group the same Skill name and exact version into one
conversation item with all observed source types; an installed copy of the
same CLI-bundled identity is not another Provider. Keep different versions
separate, never use source count or discovery order as precedence, and do not
scan plugin caches or persist this discovery list.

When the Graph enters through `markdown-provider`, first require the completed
capture report and report the visible `context-markdown-indexer*` Skills before
building the route input. Treat only the report's exact `source_inputs` as
current evidence. Do not infer semantic ownership from filenames, titles, or
headings, and do not persist the discovery list. Capture proves byte/currentness
only; the selected Markdown Provider remains responsible for semantic indexing.

Return only the compact current-Action result:

```yaml
stage: provider-selection
host_visible_skills: []
indexers:
  - <one complete selected Indexer registry entry>
```

`host_visible_skills` contains only non-CLI observations already visible to
the Host. `indexers` contains the semantic registry entries selected for the
unchanged requirements in the Action input. Select portable distribution
locators and exact versions and integrities. Each required
requirement/domain/source/module owner cell needs one primary Indexer;
overlapping read scope is allowed for enrichers. One Indexer may combine a
primary layer, supporting profiles, extension layers, and composers, but
Provider array order is not precedence.

Choose the applicable CLI-bundled community profile directly when no visible
specialized Provider is required. The CLI constructs the full route input,
performs fallback/conflict checks, validates the proposal, resolves and stages
bundles, and atomically applies `src/indexers.yaml`. If the current Route reports
a primary owner conflict or an uncovered required cell, present that exact
problem and wait; never invent a Provider or weaken the requirement.

Submit the result only through the exact `context action complete-current`
command returned by the Route. Never call the low-level route, validation,
resolution, staging or apply commands as a production workflow. If a selected
external Provider needs Host resolution, the next current Route exposes that
existing Host Action and its exact request; invoke it once and submit its Host
result through the next `complete-current` command. If the resolved Bundle carries a
non-allowlisted program, continue through the returned existing program-execution
Gate; never bypass it or fall back to its low-level command.
