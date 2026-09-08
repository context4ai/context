---
name: context-inspect-search
description: Use only when the user explicitly invokes context-inspect-search to query a Context workspace's approved knowledge and trace answers to its registered documents or source code. Do not auto-start for ordinary coding, planning, debugging, or an active Context production workflow.
disable-model-invocation: true
---

# Context Inspect Search

Answer questions from a selected knowledge workspace, then investigate its
sources when the answer needs verification. This is an independent query entry,
not an Indexer or a production Route. Use the conversation language.

## Invocation and scope

Start only on the user's explicit command or named Skill invocation. Continue
related follow-up questions without repeated invocation; stop applying this
Skill when the user changes task. An existing workspace, error message, or
knowledge-related phrase is not an activation signal.

Locate the user-selected workspace. With the CLI available, use
`context entry [project-dir] --format json` to identify it and its installed
instructions. This is inspection: do not execute a returned production command
just because it is actionable. If the CLI is unavailable or state inspection
fails, readable files can still support a bounded answer; report what could not
be checked. Do not initialize a replacement workspace or install tools silently.
If several workspaces could match, resolve which one the user means.

Keep all paths relative to that workspace. Read its `AGENTS.md` and relevant
configuration before investigating. The presence of a `.tmp` directory alone
does not establish a workspace. Querying must not clear caches, reset tasks,
change checkouts, accept Review, or start Author or close. The one permitted
query preparation build is described below.

## Choose the query material

**Prefer an existing usable dist.** Locate the package output from the workspace
configuration and inspect its index and `context-build-inventory.json`. Choose
the package matching the question; do not silently combine unrelated packages.
A usable package has readable delivered pages, not just an existing directory.
Read its bundled query Skill (usually `skills/knowledge-query/SKILL.md`, but
business templates may use another name) and use its navigation and search
instructions within that package. If it has no query Skill, use its readable
indexes and pages; a missing Skill alone is not a reason to rebuild. Do not
execute unrelated scripts merely because they are bundled.

Do not build first when usable output exists. It represents its last successful
build and selected scope, not necessarily the latest approved workspace content.
A search miss does not make the package unusable or justify a rebuild. For a
latest-content question or an apparent gap, inspect the corresponding approved
knowledge and distinguish it from the delivered version.

**If no usable output exists, try one build when allowed.** Inspect the current
Route/status and configured package. Only use the normal CLI build action when
its prerequisites are already satisfied and it will not advance an unrelated
active delivery or revision. Do not create package configuration, approve a
template, run close, recover production state or finish pending work just to
make this query possible. When a safe build is available, run its current
command once in the identified workspace, wait for the same invocation's exit
and receipt, then inspect its actual output and query Skill. Do not launch a
second writer or treat partial output as a completed package. There is no
unverified promise that this takes less than 20 seconds.

**Otherwise query approved knowledge directly.** If the CLI is unavailable,
state cannot be checked, build is not allowed, or the attempt fails, briefly
explain the limitation and continue from readable approved knowledge. Do not
loop through build repairs. Use `knowledge/structure.yaml` to locate pages,
collections and source associations; search selected `knowledge/` paths with
Host file tools, trying domain terms, symbol names and synonyms. Read relevant
sections in context. A search miss proves neither absence of knowledge nor
absence of the underlying capability. Candidates and `.tmp` reports may explain
pending work but are not approved knowledge. If approval cannot be established,
state that limitation rather than treating arbitrary Markdown as approved.

## Trace delivered answers to workspace sources

For a dist hit, find its `dist_path` in the matching package inventory's
`approved_knowledge.files` and follow that record's `approved_path` into the
workspace. `approved_path` is relative to the workspace's `knowledge/` root,
not the dist directory or workspace root; do not guess the mapping from similar filenames. Read that page and its source
associations in `knowledge/structure.yaml`, then follow the registered sources.
If the inventory or mapping is missing, still answer from readable package
content where possible, but do not claim verified original-source attribution.

The chain is: delivered page → build inventory mapping → approved knowledge and
structure → registered raw material at its recorded version. The current
approved page can have changed since build; describe differences rather than
silently replacing one version with another. Dist and knowledge are two forms
of the same content, not independent corroborating evidence. The bundled query
Skill owns package-local retrieval; this explicitly invoked inspection Skill
owns the subsequent, separately scoped workspace/source investigation. Cite
which layer supports each claim.

## Prepare only the sources needed for attribution

Follow the relevant page's source references and `sources/*/index.yaml` records.
Check the selected raw body, attachments or repository module and its recorded
version before claiming deep attribution. This readiness check concerns the
selected materials, not completion of the active production workflow.

For repositories, `context source recovery-plan --format json` provides a
read-only recovery plan. Reuse an accessible checkout only after checking its
remote, pinned commit and module path. Inspect local changes as well: a matching
HEAD does not prove a dirty file is the recorded source. Do not silently use the
latest branch or reset a user's checkout.

If material is missing, report what cannot be verified and offer the smallest
necessary recovery. With the user's recovery authorization, follow the installed
`repository-source-recovery.md` procedure and schema in the workflow bundle
identified by entry, using the CLI's `source restore` contract. Recover only the
selected source groups; never run `task prepare` or the whole workspace-reset
procedure to enable a query. If a writer is active or recovery cannot safely
coexist, keep the answer bounded and defer the write. Do not invent recovery
payload fields when the installed schema is unavailable.

For documents, notes and sessions, read their saved source bodies or summaries
and necessary attachments. A summary is not a full conversation transcript.
An external link is not evidence of its unread target. Fetch missing external
material only within the user's authorized scope; current remote content is not
proof of an older snapshot. If historical raw material is unavailable, identify
the gap rather than reconstructing it from generated knowledge.

## Explain and verify

Trace from the approved claim to the relevant source location. Expand to
adjacent definitions or tests only as necessary and within the selected source
scope. Distinguish declared API, implementation behavior, test assertions and
observed runtime behavior; reading code does not prove a runtime experiment.
Apart from the bounded package build above, do not run repository builds, tests
or arbitrary scripts merely to answer a query. If runtime validation is needed, explain the proposed check
and obtain the user's authorization for that scope.

Lead with the answer, then cite concrete page paths and source locations,
including the version when it affects the conclusion. Separate confirmed facts,
inferences and unavailable evidence. If source versions differ, describe the
difference before deciding that a knowledge page is wrong. Do not dump runtime
ids, long raw excerpts or a mandatory audit report into every answer.

## Suggest improvements and hand off

When evidence supports a correction or worthwhile addition, briefly describe:

- the affected page or missing topic and the reader's actual problem;
- the supporting source location/version and what it establishes;
- whether to revise an existing page, adjust discoverability, add a topic, or
  obtain missing material first;
- the bounded pages/sources involved and any uncertainty.

Check the existing scope and neighboring pages before recommending new content.
Do not create a page solely because a search missed it, and do not propose
unsupported claims as a knowledge update. With insufficient raw evidence, give
an actionable material request instead of forcing an update.

A suggestion is not authorization to write. Only when the user accepts the
update, hand the question, evidence, proposed change and scope to the installed
`context` production Skill in the same workspace. Read its fresh Route; it owns
candidate repair, approved-page revision and scheduling around active work.
Do not clear state, reuse an earlier revision, directly edit knowledge, or build
a second update workflow. If the production Skill/CLI is unavailable, provide
the handoff information and state that no update has started.
