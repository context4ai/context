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
CLI-bundled catalog. Select applicable Providers using that input and the Skills
already visible in this conversation. Do not run a separate catalog command,
enumerate every installed Skill, or require a discovery report/confirmation.
For a selected shipped Provider, copy its exact version, integrity and
cli-bundled distribution from the supplied catalog. The same Skill/version
visible in the Host is a projection, not another Provider or a reason for Host
resolution. If selecting a relevant external Skill, read only its exact
Host-exposed frontmatter and sibling `context-indexer.yaml` needed to identify
it; manifest version is authoritative. Do not guess missing versions, substitute
a different version, or scan caches. Read Provider guidance only when selected.

When the Graph enters through `markdown-provider`, first require the completed
capture report. Treat only the report's exact `source_inputs` as
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

`host_visible_skills` contains only relevant non-CLI observations already
visible to the Host; leave it empty for a CLI-bundled selection without external
observations. It is not an inventory of installed Skills. `indexers` contains
the semantic registry entries selected for the
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
