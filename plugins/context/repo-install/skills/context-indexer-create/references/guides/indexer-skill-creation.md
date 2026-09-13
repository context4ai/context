# Creating a reusable Indexer Skill

An Indexer is source-specific investigation and writing guidance. It helps the
Agent understand authorized material and produce useful articles; it does not
own workflow routing, source authorization, review or permanent article identity.
Several skills may contribute to one module or article.

## Minimal package

Start with SKILL.md. Add references for substantial source-specific guidance,
templates when they help readers, and scripts only when a concrete repeated
operation needs deterministic assistance. A simple note interpreter needs no
script, manifest, profile registry or template catalog.

Use a discoverable name and a precise description. State when the skill helps,
which sources it understands, and real limits. Refer to bundled resources by
portable relative paths. Use an existing host-visible Indexer as a behavioral
example, not as a collection of fields to copy.

Do not generate context-indexer.yaml, an exact-version selection ritual,
integrity receipts, primary/extension ownership, article producer records or
a per-member disposition protocol. A release may have ordinary package
metadata; that is not a requirement for the Agent to verify before working.

## Investigation produces a skeleton

Explain the recognizable source signals and how to examine them cheaply.
For code, identify useful feature families from declarations or registrations,
with names and locations. A dependency or filename is a hint, not proof of
runtime behavior. For documents, use titles, opening excerpts and heading
hierarchy, with optional full reading to settle grouping. For saved notes and
sessions, directly interpret the provided record rather than scanning history.

A technology-specific helper, if needed, must have an explicit input boundary,
bounded time/output and a useful stopping behavior. Return names, counts and
entry locations, not source bodies or a full symbol/relationship graph during
planning. Distinguish checked counts from totals and identify unfinished scope.
Do not fabricate feature counts from file counts or silently treat timeouts as
empty results. Store large results in temporary files rather than long stdout.

Document any prerequisites and error recovery. Do not install dependencies,
parse the whole repository or read unrelated modules by default. A helper that
needs expensive semantic analysis belongs to selected writing tasks, not the
initial investigation path. Direct Agent investigation is a valid default
when a helper adds no useful capability.

## Guide topics without owning the plan

Describe which reader questions visible signals can suggest, and what further
evidence the writer needs. A route family, component or storage boundary may
justify a recurring outline, but not an automatic fixed number of pages.
A component manual may require individual analysis during writing.

Use existing article titles, descriptions and references as navigation, then
read relevant bodies or sources when necessary. Code can establish structure;
documents may supply better business topics. Multiple authorized sources may
form an article. Avoid duplicating a page merely because another skill or
source family supplied its material.

The current stage provides available-skill declarations and temporary planned
usage. The Agent selects useful skills and article batches. Keep uncertain
investigation and real evidence gaps visible. Required scope cannot be dropped
to reduce processing cost, and long-term exclusions require the applicable
user decision.

## Writing and file handoff

Explain source authority, meaningful reader output, real references and
revision behavior. Keep examples, assumptions and confirmed facts distinct.
A session summary is not a transcript; a change URL is not proof of deployment;
a declaration or test double is not independently verified runtime behavior.

Consume the current task directory, not a copied schema from a past release.
New articles use the supplied Markdown/reference contract; revisions can use
the task's base article and fragment edits. Write drafts and manifests to the
designated Agent temporary directory. The coordinator submits a finished
subset through the current CLI action and follows its receipt or recovery.

Do not write formal knowledge or mutate sources directly. Do not add a
parallel Author/Composer result envelope, semantic graph, field-by-field fact
ledger or skill identity to formal content. Source permissions, input
baselines, real citations and safe writes remain CLI responsibilities.

## Validate the claimed capability

Check skill frontmatter and every referenced local resource. Run new scripts
against small anonymous fixtures, including an empty input, a bounded partial
scan and any failure/recovery behavior they claim. Confirm the helper does not
escape its selected scope or emit secret/source-body dumps.

Exercise useful output, insufficient evidence and a revision of an existing
article. For source families advertised by the skill, include representative
differences: an unadopted proposal, a document requiring optional deeper reading,
or two technologies in one module. Do not claim support for families not tested.

A static resource check does not prove semantic quality, and a reviewed example
does not prove the CLI submission works. If an actual Context run is available
and requested, validate through the existing workflow in an isolated workspace,
including report confirmation and file submission. Report unavailable checks
honestly; do not fabricate a route or silently install tools to make it pass.

## Distribution

Keep the package portable and use the user's chosen installation channel.
The host lists available skills; planning records only useful temporary usage.
Formal articles, sources and necessary long-term scope decisions survive a
new machine. Unfinished drafts, candidates, skill choices and execution receipts
remain temporary; a new user can start a fresh production run without restoring
the former skill bundle or process.
