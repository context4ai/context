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

Report the exact CLI-bundled catalog together with other Indexer entry Skills
already visible in this conversation. For an exact Skill root already exposed
by the Host, read only `SKILL.md` frontmatter and the sibling
`context-indexer.yaml`: the manifest version is authoritative and
`metadata.context-provider-version` must match it. Do not load Provider guidance
until selection. Group the same Skill name and exact version into one
conversation item with all observed source types; an installed copy of the
same CLI-bundled identity is not another Provider. Preserve distinct source
observations in `visible_skills`, keep different versions separate, and never
use source count or discovery order as precedence. Do not scan plugin caches or
persist this discovery list.

When the Graph enters through `markdown-provider`, first require the completed
capture report and report the visible `context-markdown-indexer*` Skills before
building the route input. Treat only the report's exact `source_inputs` as
current evidence. Do not infer semantic ownership from filenames, titles, or
headings, and do not persist the discovery list. Capture proves byte/currentness
only; the selected Markdown Provider remains responsible for semantic indexing.

Produce `context.indexer.provider-route-input/v1` for the current, unchanged
requirement set. Select portable distribution locators and exact versions and
integrities. Each required requirement/domain/source/module owner cell needs one
primary Indexer; overlapping read scope is allowed for enrichers. One Indexer
may combine a primary layer, supporting profiles, extension layers, and
composers, but Provider array order is not precedence.

On the first pass set `community_fallback_attempted: false`. If the CLI records
the route Action as `partial`, retry with the applicable CLI-bundled community
profile and set it to `true`. If the CLI reports conflicting primary owner cells,
do not choose one by name order: present the exact conflict and wait for a
decision. If fallback still leaves an unowned required cell, preserve the exact
CLI `capability_gap_proof` and record `blocked`; never invent a Provider or
weaken the requirement. Only the following `propose-indexer-customization`
Action may use that proof to draft a dependency-free minimal `extend`.

Record the CLI Route Action outcome exactly from `route.graph_outcome`. Only a
`completed` report may pass its `selection_proposal_input` to
`validate-indexer-selection-proposal`. Provider resolution and execution remain
separate Actions.
