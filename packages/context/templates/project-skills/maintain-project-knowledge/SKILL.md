---
name: maintain-project-knowledge
description: Maintain a project-local Context knowledge workspace by checking registered repository and document sources, selecting the affected project scope, and handing lifecycle actions to the installed Context Skill. Customize the name, description, project facts, and impact map before using this template in a real project.
---

# Maintain project knowledge

Use this file as a project adapter, not as a copy of the Context workflow. Read
the installed Context Skill first and treat its current Route, resources, and
commands as authoritative. Keep only stable project facts and source-impact
mappings here.

## Repository sources

Start with the current Context Route. If registered repository modules are
missing or their local links are broken, follow the route-selected repository
recovery procedure. Let the user choose an existing checkout, authorize a scan
inside one bounded directory, or explicitly clone the registered pinned commit.

When a checkout already exists, inspect its origin, HEAD, dirty state, and
registered subpaths before asking whether to keep the recorded commit or update
to another explicit commit. Never pull, switch, clean, or reset an external
checkout without separate authority.

Repository sources are ready for knowledge work only when every selected module
resolves to its registered remote and commit, all required subpaths exist,
unknown local changes are preserved, Context has materialized its module links,
and the current Route no longer reports a repository-readiness blocker.

Add the project's stable mapping from repository changes to declared extraction
scope here. Do not infer this mapping from filenames during a maintenance run.

## Remote document sources

Use the current Context Route and the installed document-provider Skills or CLI
to read registered remote documents. Keep this section short: provider login,
permissions, capture, sub-page traversal, and fidelity diagnostics belong to
the provider and Context resources selected for the current step.

A remote document is ready for knowledge work only when its registered identity
is unchanged unless the user explicitly adds a new source, the current account
can read the required body and assets, relevant child pages are represented as
their own sources, capture fidelity has no blocking error, and the current Route
allows structure or extraction work to begin.

Add project-specific source ownership, expected document families, and update
boundaries here. Do not copy credentials, source bodies, or volatile command
lines into this Skill.

## Project facts and completion

Record only durable project paths, declared package outputs, physical-to-logical
repository grouping, and evidence-backed impact rules. Do not duplicate Context
phase commands or manually edit lifecycle-owned directories.

Report completion using the current Context Route and build receipt, including
the checked source range, changed and unchanged knowledge, unresolved permissions
or fidelity blockers, and whether a package was built or separately published.
