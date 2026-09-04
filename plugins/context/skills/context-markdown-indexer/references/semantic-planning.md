# Source, subject, and claim planning

Use these rules while producing the current `main-index` `ArtifactResult`.
Captured Markdown is ordinary source material: it may create or enrich the same
knowledge candidates as code-derived input. If required material is still
missing, return a material-gap disposition and let a later main-index run consume
the newly captured source. Do not create an answer-only result, landing, or
second review workflow. Context remains the authority for schemas, SubjectKey
normalization, identities, paths, collisions, stale state, layout changes,
Review, and publication.

## `reader-subject` partition strategy

For a partition workset, group captured document members by durable reader
subject rather than by file, heading, route, or temporary capture batch. Use
the complete authorized document text together with maintained title,
`source_path`, route, audience, and reader-task evidence. These fields are
evidence for the decision; none is sufficient by itself.

One group may contain multiple documents when they jointly explain the same
reader subject. Split platform or runtime variants only when their supported
contract, behavior, lifecycle, or reader task is materially different. Keep
navigation-only indexes, generated duplicates, empty placeholders, and
superseded pages out of authored groups with an explicit inventory
disposition. Every current inventory member must still receive exactly one
partition disposition. If durable subject boundaries cannot be established,
fail this semantic strategy so Context can use its existing catalog fallback;
do not silently return one group per file under `reader-subject`.

## Evidence and authority

Read every authorized evidence item required by the current workset before
making a source-wide decision. A file name, URL, title, heading, navigation
label, polished wording, profile id, or example is a navigation signal, not
proof of subject identity, authority, or reader intent.

Use only current source roles, authorized source views, target-resolution views,
and question targets supplied with the workset. Supporting or context-only material
may guide investigation but cannot become a cited Section or structured claim
unless the current authority makes it eligible. Preserve exact identifiers,
commands, links, numbers, conditions, code, and source-authored uncertainty.

Positive example: a Section is classified from its complete requirement text
and stated audience. Negative example: a document is classified as a runbook
only because its path contains `ops/`.

## Subject boundary

The primary logical-unit SubjectKey is fixed by the workset. Do not replace it
with a title-derived key. When Context supplies target-resolution entries,
close every entry with exactly one current disposition:

- `reuse-existing` only for an exact evidence-supported subject match;
- `create-independent` only when evidence establishes a distinct durable
  subject and separate reader value under a permitted SubjectKey schema;
- `request-material` when a semantic decision is possible but identity facts
  or authority are insufficient;
- `unsupported` when the required parser, evidence kind, or capability is not
  available.

Treat local material as a Section before proposing an independent subject or
Artifact. A heading, table row, FAQ label, warning, short example, relationship
phrase, or one-off conclusion does not establish independent identity. A
concrete product or technical object, an atomic term, a repeatable process with
source-backed steps and outcome, or a real grouping scope with supported child
subjects may justify a separate subject when the current schema permits it.

Positive examples include an independently named service with its own contract,
or a repeatable recovery procedure with actors, steps, outcome, and standalone
retrieval value. Negative examples include “component usage” as one sentence,
“three modes” as a parallel list, a navigation-only placeholder, or “X impact
on Y” without an independent referent. Keep those as Sections, registered
questions, or unresolved target decisions as appropriate.

Titles and headings are evidence, not identity. Keep reader-facing labels in
the authored content; do not invent aliases, slugs, collections, containment,
or paths to force a match. A subject shaped like a grouping scope needs current
supported child identities. A process-shaped subject needs actual process
evidence, not merely a word such as “flow”, “migration”, or “strategy”.

## Section and Artifact planning

Apply `classification.md` and `structure-and-artifacts.md` at Section scope.
Keep source-backed Sections continuous when possible. Split unrelated reader
tasks even under one heading; merge adjacent headings only when they form one
coherent answer with compatible projection intent. A dedicated Artifact must
clear the same independent reader-task and evidence-boundary test regardless of
content type.

Use density only to choose an inspection granularity. `macro`, `meso`, `micro`,
and `single-pass` never choose a SubjectKey, authority, projection intent, or
quality outcome.

## Relation and structured-claim gate

Emit a structured claim only when its subject is authorized, its owner Section
exists, and the cited evidence in that same Section supports the claim kind.
Do not convert a vague “related” mention, shared table membership, name
similarity, containment, or endpoint-only evidence into a stronger relation.
When evidence conflicts and source precedence does not resolve it, preserve the
conflict in the supported diagnostic or material-question disposition instead
of selecting by file order, heading order, or polished wording.

Source-authored uncertainty belongs in the reader prose when it is material.
Do not use a confidence label to conceal Agent uncertainty, and do not invent a
structured field that the current schema does not expose. Missing endpoint,
ownership, or relation evidence must remain unresolved rather than becoming a
dangling claim.

Positive example: a cited Section explicitly states that one component consumes
another component's output, and both subjects are authorized. Negative example:
two components appear in one “See also” list, so the Indexer invents a runtime
dependency.

## Content-purpose precision

Choose the narrowest registered Section projection intent. Preserve these
semantic boundaries when they apply:

- a decision needs alternatives or options, the selected path, and rationale;
- an incident review needs incident identity plus impact/timeline and cause,
  response, mitigation, or follow-up evidence;
- a test/validation Section needs a checkable target, scenario, observation, or
  acceptance result;
- a standard/policy Section needs a stable normative rule or constraint;
- a task or migration guide needs a reader action, verification, and relevant
  recovery boundary;
- an example is literal sample material, not ordinary scenario prose;
- a comparison distinguishes at least two subjects across meaningful
  dimensions.

If the registered vocabulary cannot express the evidence, return a material or
capability disposition. Do not use a broad narrative label merely to avoid the
missing-intent path.

## Duplicate, deletion, and recovery rules

Collapse duplicate statements only when their subject, authority, reader task,
and evidence boundary are the same. Preserve separate Sections when authority,
lifecycle, reader task, or evidence boundary differs. Omit material only under
the eligible reasons in `editorial-policy.md`; an answered question, actionable
limitation, replacement-bearing deprecation, source-backed decision, or
recovery instruction remains knowledge.

On an ambiguous target, return the current unresolved/material disposition. On
a stale workset, digest mismatch, schema mismatch, collision, or forged layout,
stop and use the fresh Context route; do not repair the failure by changing a
semantic label, inventing an alias, or hand-authoring a path. A destructive or
ambiguous layout change is handled by Context's conditional human Gate. A
non-destructive addition does not create a review pause merely because it is
new.

If the same current semantic quality problem survives three accepted revision
attempts, keep already-passing Sections intact and request one aggregated piece
of content-organization, source-fidelity, or missing-material guidance. Retry
history and assessments are runtime audit data, never reader knowledge.

Before returning the Result, verify that every required evidence item and
target-resolution entry has a disposition, every Section has one current
projection intent and evidence boundary, every claim is owned and cited, every
duplicate/conflict decision is explicit, and no collection, path, temporary
identity, placeholder, or unsupported claim appears in the Result.
