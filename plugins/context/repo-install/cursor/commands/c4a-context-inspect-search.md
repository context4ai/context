---
description: "Query available Context knowledge packages or approved workspace knowledge and trace answers to their identified sources when the user asks a knowledge question or the host configuration routes the request here. A local workspace is optional. Do not auto-start for ordinary coding, planning, debugging, or an active Context production workflow."
---

# Context Inspect Search

## Entry and boundaries

Use on explicit invocation and related follow-up questions; use the conversation
language. The invocation authorizes read-only investigation of the selected
knowledge packages, available workspace and identified sources within that scope,
including isolated source retrieval and bounded non-destructive checks. The Skill
can run from a global installation with host-provided packages and no workspace.
Resolve scope from the request, conversation and configuration before asking.
Continue through non-blocking issues; ask only for missing access, genuinely
unresolved scope or effects outside existing authorization.

Start from the supplied package locations or workspace configuration. If a
workspace exists, read its `AGENTS.md` and relevant configuration;
`context entry [project-dir] --format json` may help locate instructions.
Neither a workspace nor a working Context CLI is required for package retrieval;
do not call entry in an arbitrary directory just to satisfy a prerequisite.
Do not execute returned production actions, initialize a replacement workspace,
or install tools without existing authorization. Querying must not alter source
registrations, snapshots, tasks, approvals or user checkouts.

## Search available material concurrently

Check relevant knowledge packages, the workspace and reusable source checkouts
in parallel. Search each as soon as it is readable; tool checks and authorized
upgrades must not block independent reading. If a missing configured workspace
is needed for further attribution, recover it into an isolated directory while
package retrieval continues. Without a configured workspace, investigate the
available packages directly; do not request or create one merely to start.

A knowledge package may be workspace build output (usually `dist/`), a global
installation, or an equivalent host-provided directory. Locate it from available
configuration or installation metadata rather than assuming a fixed path.
Select packages relevant to the question. Follow their bundled query Skill when
present; otherwise search readable indexes and pages. Missing Skills or build
inventories do not block retrieval or justify rebuilding. If a needed package is
missing, use the host's configured, authorized package retrieval mechanism while
other reading continues. Only check or prepare tools needed for the next actual
operation; installation failure does not block independent local retrieval.

For gaps or latest-content questions, also search approved knowledge when a workspace is available:
use `knowledge/structure.yaml` and relevant `knowledge/` paths, trying business
terms, symbols and synonyms, then read matching sections in context. Delivered
content may lag approved knowledge; they are not independent corroboration.
Candidates and temporary reports are not approved pages. A search miss does not
prove a capability is absent. Do not build merely to answer a query; a separately
authorized build must follow its own workflow without advancing unrelated work.

When package or approved knowledge leaves a gap, directly trace relevant sources
without asking whether to deepen the query. Use available document, code-search
or extraction tools within the authorized scope, recording source identity and
version. Prepare sources while continuing other reading.
One failed source blocks only dependent claims. Answer when evidence is
sufficient, without completing unnecessary preparation.

## Trace and retrieve only relevant sources

Without a workspace, use explicit source references in the package, its metadata
or user configuration to identify relevant documents or repository paths and
commits. Read or retrieve those sources directly within scope; the workspace
registry is not a mandatory intermediate step. If the source identity or version
cannot be established, retain package-grounded findings and qualify attribution;
do not invent a repository or equate current source with the package's baseline.

When a workspace and `context-build-inventory.json` are available, map a delivered page's
`dist_path` through `approved_knowledge.files` to its `approved_path`, relative
to the workspace's `knowledge/` root. Follow the approved page's associations in
`knowledge/structure.yaml` and `sources/*/index.yaml`. Without a reliable mapping,
continue package retrieval and follow explicit source references where available.
Do not guess originals from similar filenames or claim attribution without
checking the referenced material.

Use the repository and recorded commit identified by the package or workspace
as the source baseline.
Reuse existing checkouts only after checking remote, commit, module coverage
and local changes; do not reset them or change their sparse configuration.
Missing code goes into a reusable query-owned path such as
`.tmp/context-inspect/<host>/<repository-path>/<commit>/`, separate from user
checkouts and production-managed sources. Use safe, credential-free path
components and the full commit. Verify identity before reuse; never overwrite
a mismatched directory. Deduplicate recovery and use one writer per checkout;
that writer may append sparse paths without resetting existing files.

Default to lightweight retrieval and sparse checkout:

- Use shallow history (`--depth=1`) and deferred contents (`--filter=blob:none`)
  where supported, with a complete partial-clone setup and named promisor remote.
  Configure the sparse scope before checkout and verify the resulting commit.
- Start from known module paths. If unclear, inspect
  `git ls-tree -r --name-only <commit>` for candidates, then read code to confirm
  their relevance. Expand along imports, calls and service routes as needed;
  deepen history only when needed. A sparse search miss is not a whole-repository miss.
- Read ready modules while other recovery proceeds. Allow sufficient command
  time (for example 300 seconds or more), but investigate confirmed stalls
  without waiting for timeout; silence alone is not a stall. If unsupported or
  unsuccessful, try caches, commit-specific file retrieval or bounded shallow
  retrieval; use a full clone only when necessary. Do not retry blindly or
  silently substitute the default branch for an unavailable recorded commit.

Query retrieval never runs `context source restore`, `task prepare` or production
capture/recovery actions. Production recovery gates do not block this independent
inspection. Preserve unavailable-evidence gaps rather than changing production
state to get past them.

Compare relevant baseline files with current code when accessible, including
relevant local changes. Use actual diffs to assess impact; current code is not a
substitute for the baseline. Mention a missing comparison only when it limits
the answer. For documents, notes and sessions, read saved bodies and necessary
attachments; fetch missing accessible material within scope. A summary is not a
full transcript, an unread link is not evidence, and current remote content does
not prove a historical snapshot.

## Answer with evidence and hand off updates

Lead with the conclusion and a concise evidence chain. Distinguish implementation,
declared contracts, test assertions, runtime observations and inferences. Perform
bounded non-destructive validation only when useful; inspect its effects first
and do not run unrelated scripts, builds or tests.

Link material actually read: source files at the inspected commit, knowledge
website articles and original documents. If no reliable clickable link exists,
give checkable local paths, symbols and short supporting excerpts with the
limitation. Do not dump internal reasoning, runtime identifiers or routine
version comparisons. Explain only differences affecting the answer; hashes may
appear in source URLs without requiring a separate version audit in the prose.

For website links, use `context-site-map.json` from the selected package or
sibling website output. Match `pages[].package_path` or `approved_path`, and
resolve `site_path` against `site_url` without prepending `base` again. Cite only
matched pages, deduplicate links and do not invent anchors. If mapping is absent
or invalid, retain local citations. Do not build, publish or probe remote sites
just to format citations; a local map is not proof of the current online content.

Suggest a knowledge update only with supporting evidence: identify the affected
page or gap, proposed change and bounded source scope. Check neighboring content
before proposing a new page. Only after user acceptance, hand the evidence and
scope to the installed `context` production Skill in the selected workspace and
its fresh Route. If no target workspace is known, resolve it at that handoff,
not as a prerequisite to answering. Do not edit approved knowledge, clear state
or reuse an earlier revision. If that entry
is unavailable, provide the handoff and state that no update has started.
