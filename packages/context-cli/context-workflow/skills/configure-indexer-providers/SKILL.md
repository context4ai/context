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
the `context.indexer.provider-guide` resource at the exact path in the current Route
for the registry-only default, Provider-layer rules, conflict handling and
completion conditions. This Action is the entry for
`indexer-provider-required`; when an exact distribution is unavailable, follow
the guide's `indexer-provider-unavailable` handling instead of substituting a
different version or cache.

The current output schema defines each accepted Indexer entry. Use the guide's
Provider selection example with the current requirements and catalog values;
the requirements-only bootstrap schema is not this Action's result schema.

The current Action input already contains the exact requirements and
CLI-bundled catalog. Select applicable Providers using that input and the Skills
already visible in this conversation. Each bundled entry includes compact
`capabilities` and exact `guidance.skill_path` / `guidance.manifest_path` for
the shipped release. Read those files only for a Provider you intend to select
when its guidance is not already available; resolve its relative references
against that supplied bundle, not an arbitrary installed copy. Do not run a separate catalog command,
enumerate every installed Skill, or require a discovery report/confirmation.
For a selected shipped Provider, copy its exact version, integrity and
cli-bundled distribution from the supplied catalog. The same Skill/version
visible in the Host is a projection, not another Provider or a reason for Host
resolution. If selecting a relevant external Skill, read only its exact
Host-exposed frontmatter and sibling `context-indexer.yaml` needed to identify
it; manifest version is authoritative. Do not guess missing versions, substitute
a different version, or scan caches. Read Provider guidance only when selected.

Business skill installation and switches belong to the Host. Discover relevant
currently visible `context-…-indexer…` skills and read their actual manifests.
Do not override a disabled default or a selected business replacement just
because the CLI catalog lists it. There is no second CLI enable registry.

Use Note/Sessions Providers for independent reader topics from those sources;
a session does not require code association. FAQ, guide and decision are reader
forms, not source types. Existing Code/Markdown pages retain one primary and
receive supporting sources in their evidence/read scope. If specialized source
interpretation is needed, explicitly select a compatible extension layer with
`kind: extension`; `supporting` profiles are only from the same primary layer.
The primary writes one final page, without duplicate session/note targets.

When the Graph enters through `markdown-provider`, first require the completed
capture report. Treat only the report's exact `source_inputs` as
current evidence. Do not infer semantic ownership from filenames, titles, or
headings, and do not persist the discovery list. Capture proves byte/currentness
only; the selected Markdown Provider remains responsible for semantic indexing.

Choose skills to cover the useful regions agreed with the user, not every
capability a Provider advertises or every file in a registered source. Distinguish
regions that need knowledge pages from materials only needed to support them;
available material does not automatically require a separate skill or page.
If representative reading exposes a substantial unresolved scope tradeoff,
clarify it through the existing requirement workflow before dependent selection.
This selection Result must not silently change requirements or expand read scope.

Once purpose and scope are settled and the applicable Provider capabilities are
known, use `procedure.work-start-report` and `template.work-start-report` from the
current Route when the work warrants a report. This is the last planning handoff
before Partition: write or update `.tmp/work-start-report.md` with the Host file
tool. Explain discovered Indexer choices and non-selections using the supplied
catalog, visible relevant Skills and this task's materials; label unapplied choices
as proposals. Follow the report procedure's reading invitation and pause before
submitting the normal Provider selection below, unless explicitly waived.
A useful report already formed during requirement setup should be reused; do not
restart discussion or add report fields to the selection Result.

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

Keep catalog capabilities and guidance paths out of the submitted entries;
they are selection help, not registry fields.

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
