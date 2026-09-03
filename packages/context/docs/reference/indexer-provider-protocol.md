# Indexer Provider protocol

Context defines one Provider manifest, `context-indexer.yaml`, with protocol
`context.indexer.provider/v1`. Code and Markdown Providers use the same field
tree; `domains`, profiles and declared operations describe their applicable
inputs.

This page documents the protocol surface currently exposed by `@c4a/context`.
It does not imply that the 0.7.0 CLI Route or its release channel is complete.

## Resources and execution

A Provider may contain a controlled program, profile-bound instructions,
templates, an activation detector and an authoring inspector. Executable
resources use only:

```yaml
execution:
  runtime: node
  entry: scripts/index.mjs
  args: [--format=json]
```

`entry` is a portable path inside the verified Bundle. `args` are literal
arguments. A free-form command, shell expression, environment interpolation,
absolute path or parent traversal is invalid.

The CLI never launches an executable from a discovered Skill installation
directory. A Host or the CLI first resolves an exact Provider envelope, verifies
the complete file ledger, and copies it to a content-addressed runtime stage.
The controlled launch then revalidates that stage and resolves the declared
entry there with `shell: false` and an empty inherited environment.

Allowlisted first-party and verified Bundle programs may enter the trusted
path directly. Every other Provider program, and every project-local program
even when it extends an allowlisted Provider, requires an exact
`context.indexer.program-authorization/v1` receipt from the independent
program-execution authority. The receipt binds the project, Provider
fingerprint and manifest, program origin/path/content digest, structured
execution, requested capabilities, fixed dependencies, source scope, limits
and policy digest. A local program is restricted to
`src/indexer/<indexer-id>/index.ts`; the CLI reads a regular non-symlink file
from the workspace before producing its report.

The controlled invocation rechecks the complete receipt and program identity.
Changing local bytes, the Provider Bundle, entry or arguments, capabilities,
dependencies, scope or limits invalidates the authorization. An ordinary
managed authority cannot issue this receipt, and the receipt always records
`sandboxed_program: false`: it authorizes trusted execution but does not claim
malicious-code isolation.

Optional external reads are declared separately under
`provides.tool_sources[]`. Each declaration contains only a stable id, a
versioned Host handler and request protocol, the fixed
`context.indexer.tool-snapshot/v1` output protocol, a closed operation list and
`optional: true`. It cannot contain an executable path or command. The
declaration is copied into the Agent-visible Skill capability and the final
Provider composition plan with its owning Provider layer; it does not grant
execution authority. The Host validates and executes its own installed adapter,
while Context validates the resulting tool snapshot and keeps the local parser
baseline independent from optional tool availability.

## Two-stage selection validation

`validateIndexerSelectionStatic` accepts only the proposed registry. It closes
requirement ownership, read scope, profile composition, portable distribution,
exact Provider identity/version/integrity and the data shape of stable config.
Its output is a canonical list of Provider resolution requests. This phase does
not resolve, read, stage or execute a Provider resource.

After the resolver returns and the CLI creates a content-addressed stage,
`validateIndexerSelectionFinal` consumes the exact static report. It rechecks
the resolved envelope and actual staged file ledger, loads the sole Provider
manifest, verifies profile/operation/composer/extension bindings, validates
config against the Bundle's closed data-only schema, binds the project-local
customization fingerprint and requires a policy digest for executable
resources. Missing, duplicate, stale or extra inputs fail closed.

The final stable report excludes transport paths, delivery timestamps and
runtime receipt digests. Those values remain in a separate runtime receipt
projection, so rematerializing identical content does not make the selection
stale. The workflow Route must use the static report as the hard predecessor of
resolution; the protocol functions alone do not authorize Host materialization.

The only default persistent selection authority is `src/indexers.yaml`.
Distribution locators are portable identities such as `cli-bundled://`,
`plugin://`, `workspace://`, `package://` or `marketplace://`; a discovered
Skill installation path and a runtime transport/stage path never enter the
registry or stable report. The workspace persistence audit rejects the legacy
`package.json.context.codeIndex.extensions` field. Provider-only projects also
cannot persist a `src/indexer/` directory; declared local customization is
limited to the fixed project-relative resource set.

Minimal local customization runs as a resumable subloop. An Agent draft must
consume a final CLI capability-gap proof. The CLI validates and
content-address stages the draft, then project preparation revalidates the
target selection and exact staged Providers before creating a CAS-bound
proposal. Project-local programs stop for independent execution authorization;
dependency authorization creates a new locked successor proposal instead of a
detached result. After the single transactional apply, the CLI records a
durable apply observation, verifies every target digest, reruns finalized
selection validation, and returns the applied registry for one final static
selection audit.

## Skill capability and Provider composition

Context normalizes every verified manifest to
`context.indexer.skill-capability/v1`. This Agent-visible view contains the
Skill's profiles, operations, accepted extension fragments, source roles,
logical units, composers, program capabilities and supported customization
steps. It is canonical and content-digested; it does not expose a discovered
installation path or grant execution authority.

Final selection builds one
`context.indexer.provider-composition-plan/v1` for each Indexer owner. The plan
binds every active profile to its exact Provider layer, keeps one primary
authority for each enabled operation, admits only declared pre-authority
fragments, merges identical source-role and logical-unit capabilities, and
rejects conflicting logical-unit definitions. Provider instruction resources
remain independently attributed instead of being concatenated implicitly,
layer configs remain separately digested, and an exact project template
override replaces only its matching template id/profile. Input array order is
not authority: all projections use canonical identity sorting.

The complete composition plans are part of the stable final selection report,
so downstream workset and authoring steps consume a validated composition
rather than rediscovering Provider precedence.

## Partition strategy authority

A Provider may declare profile-bound partition strategies under
`provides.partition_strategies[]` with a stable id and non-negative priority.
The manifest does not provide its own authority digest. Context derives the
implementation identity from the verified Bundle and manifest; a validated
local customization uses its exact file digest, while a CLI builtin is bound to
the current CLI release digest.

`context.indexer.partition-strategy-resolution/v1` binds the Indexer and
registry fingerprints, selected profiles, Provider integrity, optional local
customization and every strategy authority. A local declaration with the same
id replaces only that Provider strategy. All effective project strategies are
ordered by declared priority and id before any CLI builtin. A CLI builtin
cannot shadow a project strategy, and an undeclared profile or ambiguous
per-profile priority fails validation. The order-sensitive strategy-set digest
is copied into the partition workset, so reordering or changing any authority
makes prior work stale.

## Source roles and Artifact policy

A Provider may declare source-role and logical-unit identifiers, but the
selected CLI profile contract owns Artifact kinds, metrics, thresholds and
policy variants. Final selection rejects `quality_guidance.metric_ids`,
`logical_units[].artifacts.recommended` kinds and
`supported_policy_variants` that are not registered by the selected base
profile. A namespaced extension inherits this check from its declared base
profile. The strict manifest schema has no numeric limit or threshold field.

Before authoring a logical unit, the CLI evaluates each selected policy
variant's restricted eligibility selector over an allowlisted canonical-fact
projection. The resulting
`context.indexer.artifact-policy-eligibility/v1` binds the profile and operator
contracts, canonical facts, Provider-supported variant set, eligible Artifact
kinds and derived thresholds. `inflation-sensitive` maximums use the fixed CLI
rule; the Provider cannot return a threshold or self-report a pass.

An author Result declares one validated source role and, when it emits
Artifacts, one `context.indexer.artifact-bundle/v1` for its logical unit. The
Bundle chooses exactly one eligible variant and classifies each Artifact as
required, discretionary or a semantic split. The CLI requires exact agreement
between the Bundle and Result payload, registered required/discretionary kinds,
known evidence, authorized reader questions and the derived discretionary
fan-out limit. Semantic split parts retain `split_of`, the parent's kind and a
non-overlapping stable boundary. An empty Result has no Bundle; a non-empty
Result cannot omit it. There is no global hard limit on total valid logical
units or physical Artifacts.

Before author worksets can materialize Candidate content, Context requires a
canonical `context.indexer.projected-artifact-plan/v1` and runs
`context.indexer.projected-artifact-fan-out-audit/v1`. Each projection binds a
stable projection key to an exact PartitionPlan group, Bundle digest, current
CLI policy-eligibility digest and evidence justification. Missing or mismatched
owner, Bundle variant or evidence increments the unassigned count; complete
Bundles, expanded variants, semantic split parts and the single CLI
`catalog-fallback` parent do not. Counts up to 100 continue, 101 through 300
continue with a warning, and counts above 300 return the non-Gate
`indexer-plan-revision-required` outcome before any author workset runs. That
partial outcome consumes neither a user Gate nor the three-attempt profile
revision ledger.

Artifact content has three mechanically separate layers. `facts[]` contains
canonical, source-bound values and never reader prose. A structured
`deterministic-block` contains only a registered renderer and `fact_refs`; the
CLI resolves those Facts and derives both Markdown and evidence, so a Provider
cannot relabel arbitrary JSON or prose as a catalog. A `semantic-prose` block
contains evidence-bound Markdown and cannot cite Facts as a way to increase
deterministic coverage. The normalized rendered Section retains ordered
`content_blocks` with the layer, Fact refs, evidence refs and per-block digest;
its Section digest covers that ledger and the exact reader-visible Markdown.

`ArtifactResult` also carries
`context.indexer.capability-group-evidence/v1`. It repeats the complete member
set bound by the author workset even when no capability group is selected. A
non-empty capability group has a stable ref derived only from the logical unit
and capability key, at least two explicit member-to-evidence bindings, and one
or more actual Artifact Section evidence bindings. A member cannot belong to
two capability groups. Every member evidence ref must be a current Result
evidence binding and must be visible in one of the declared Sections. Unknown
members or Sections, page-level evidence without Section consumption, and
workset/member-set drift are rejected. This protocol does not assign projection
dispositions to members outside capability groups.

## Full-path example identity

Providers report normalized example observations through
`context.indexer.example-inventory/v1`. The stable `example_ref` is derived
only from the public target ref, scenario key and full path relative to the
authorized source/module root. Paths use Unicode NFC and `/`; absolute paths
and parent traversal are invalid. Source/module identity, content digest and
evidence form a separate observation ref, so additional evidence for the same
observation can merge without changing the example identity.

Context recomputes `context.indexer.example-identity-audit/v1`. Equal basenames
under different full paths are distinct examples, as are equal paths for
different targets or scenarios. Multiple distinct source/content observations
for the same complete example identity are a hard
`example-identity-collision`; a Provider cannot override the audit result or
forge an empty collision list. Candidate disposition and linkage are separate
downstream contracts.

## SubjectKey schema authority

Community profile identity rules have one authority: the top-level
`subject_key_schemas` array in the CLI profile contract. A community Provider
manifest cannot copy or replace that schema. A namespaced additional profile
has the other allowed authority: the exact owner Provider's
`composition.extensions[].subject_key_schema`. The extension declaration is
required and may use only the CLI's closed namespace/local-key derivation
operators, kind identifiers and normalization rules.

Final selection resolves both forms to
`context.indexer.resolved-subject-key-schema/v1`. The record binds the Indexer,
profile, base-contract or Provider authority, schema digest and resolution
digest. Its canonical set digest is part of the stable final selection report;
transport paths and runtime receipts are not. Subject keys must match a kind in
the resolved schema and satisfy its normalization before they can become a
canonical NodeRef.

An unchanged schema is equivalent. Adding a kind while preserving the existing
namespace, normalization and local-key operators is compatible. Removing or
changing an existing identity derivation is identity-breaking: the owning
authority must advance its major version and the schema version must increase.
When approved Nodes exist, Context requires a non-delegable
`confirm-subject-reidentification` authorization bound to the exact old/new
schema digests, approved catalog, complete deterministic mapping and report.
Missing mappings, one old Node mapping to multiple Nodes, multiple old Nodes
colliding on one new Node, stale authorization or digest drift blocks
activation. With no approved Node, the human Gate is omitted but conformance
and major-version checks still apply.

## Requirement change authority

`context.indexer.requirement-change-report/v1` retains both complete
requirements, their digests, the canonical comparator inputs, the recomputed
comparison and its report digest. Equivalent and strengthening changes use
`confirm-index-requirements` and may follow managed review authority.
Contraction or incomparable replacement instead uses
`confirm-index-requirement-contraction`; its confirmation is always human and
non-delegable, and binds the exact old/new requirement, comparison and report
digests. A self-digested caller classification is insufficient because Context
recomputes the comparator before issuing or consuming the confirmation.

Material-gap severity remains derived from the current requirement domain:
`required` is blocking, `optional` is recommended and `out-of-scope` creates no
gap. Severity is not written into worksets or the retained ledger, so a domain
change must pass the requirement Gate instead of editing a stored severity.

## Provider discovery and composition Route

`configure-indexer-providers` is a static Agent Action. It reports the exact
CLI-bundled catalog together with other Indexer entry Skills already visible to
the current Host, then returns a path-free
`context.indexer.provider-route-input/v1`. The visible list remains
conversation-only: the protocol carries names, readable versions and source
types, never installation or cache paths, and the CLI does not scan for more
Skills. When the Host exposes an exact Skill root, discovery may read only the
Skill frontmatter and sibling `context-indexer.yaml`; the manifest version is
authoritative and its `metadata.context-provider-version` copy must match.
Conversational output groups the same Skill name and exact version into one
item with all observed source types, while `visible_skills` retains distinct
source observations because its `source_type` field is singular. Identical
bundled and installed observations are not separate Providers and never create
selection precedence; different exact versions remain separate identities.

`route-indexer-provider-selection` recomputes required
requirement/domain/source/module owner cells against the unchanged applied
requirement set. Read-scope overlap is reported but remains legal. A closed
selection may contain multiple fixed Skill identities and continues as one
`multi-skill` composition to `validate-indexer-selection-proposal`. Duplicate
primary owners instead return `indexer-provider-conflict` and cannot be
resolved by YAML or discovery order.

If a first pass leaves an owner cell unmatched, the Graph records `partial` and
runs `configure-community-indexer-fallback`. The second pass is explicitly
marked `community_fallback_attempted: true`; any remaining unowned required
cell becomes `indexer-customization-required` with its exact owner cell,
coverage capability and `context.indexer.capability-gap-proof/v1`. This is the
only Provider-discovery outcome that authorizes the local-customization Route;
the proof protocol remains a capability audit artifact rather than a second
Graph outcome. Only `selection-validation-required` returns a selection
proposal input. The Route writes no workspace or runtime state, and neither a
visible-Skill claim nor the Route report authorizes Bundle materialization.

## Contract overlay validation

`validate-indexer-contract-overlays` recomputes the complete data-only overlay
against the exact CLI base and operator contracts. Invalid DSL, executable
fields, identity redefinition, threshold weakening, digest drift or a partial
Provider identity fails validation. The selected Provider Bundle integrity is
an exact input, not a self-reported trust assertion.

Successful validation emits
`context.indexer.overlay-validation-receipt/v1`. The receipt binds the exact
project, overlay, base contract, operator contract, Provider Bundle integrity
and canonical conformance report. There is no signature, KMS, trust-bundle or
overlay-authorization protocol. Changing any bound digest requires
revalidation; a stale receipt cannot be reused.

## Question amendment back-edge

A CLI base-contract question can be expanded and confirmed before Provider
resolution. `context.indexer.base-question-amendment/v1` copies the complete
canonical contract from the selected base profile, changes only the requirement
question binding, and applies the confirmed snapshot with an expected-base CAS
and durable single-file journal. A Skill question ref is guidance only; it
cannot provide or alter the contract payload.

An overlay-backed question follows a different sequence. Context first
recomputes overlay DSL conformance and verifies the exact validation receipt.
Only then may
`context.indexer.overlay-question-amendment/v1` expand namespaced question and
target-domain additions from that overlay. The target coverage domain must
already be in scope and have one existing primary owner. The amendment is a
pure strengthening and remains in runtime staging after confirmation; it is not
written as a standalone requirement update.

The executable sequence is
`propose-overlay-question-amendment`,
`confirm-overlay-question-amendment`, then
`rebind-indexer-selection-to-requirement`. Proposal and rebind inputs carry the
exact overlay validation input and result; Context recomputes and
compares that pair instead of accepting a detached receipt. Confirmation emits
the exact amendment decision and performs no project write.

The rebind Action then proves that Indexer/provider
identity, operations, scopes, profile composition, requirement bindings, owner
closure and read authority are byte-identical. It revalidates overlay
conformance,
reuses the exact staged Bundles, and reruns both static and final selection
against the target requirement digest. Provider and SubjectKey authority must
remain unchanged. Final selection resolves every CLI-base question back to its
exact selected profile contract and requires one current validation proof
for every overlay question; forged bindings and duplicate, stale, or unused
proofs fail before the final report is issued. The report binds the resulting
question authority set digest. The resulting
`context.indexer.overlay-question-registry-apply-proposal/v1` contains the full
target `src/indexers.yaml` snapshot and binds the amendment, confirmation,
overlay validation, rebound selection, SubjectKey schema set and finalized reports.
The proposal goes through the same `stage-indexer-project-proposal` and
`apply-indexer-project` Actions as ordinary registry/customization proposals.
The latter dispatches this typed proposal to one expected-base CAS, project
write lock and persistent journal, so the requirement binding and rebound
registry are committed by one complete file replacement. Recovery observes
only the old or new registry snapshot; it never reconstructs authority from a
temporary Provider path.

## Controlled invocation

`context.indexer.controlled-invocation/v1` binds:

- the exact Indexer, Provider, version, Bundle integrity and stable Provider
  fingerprint;
- the manifest-declared `runtime + entry + args`;
- requested and granted Context SDK capabilities;
- an exact fixed dependency set with package, version, lock integrity and
  resolved content digest;
- one authorized source/module scope;
- a stable trust-policy and authority digest;
- timeout and stdin/stdout/stderr byte limits.

The 0.7.0 built-in Host capability is `sandboxed_program: false`. A first-party,
verified or exact project-authorized program may use the `trusted-program` path,
which is not an isolation claim. An untrusted program without a real sandbox is
not executable.

The program input is `context.indexer.run-request/v2` with the single
`main-index` operation. Its output is `context.indexer.run-result/v1`, wrapped by
`context.indexer.controlled-program-result/v1` to bind the exact invocation and
payload digest. Context still validates the operation-specific Result and
recomputes mechanical gates independently.

## Primary execution identity and workset reads

Context derives `context.indexer.primary-registry-projection/v1` from the
finalized registry. The projection contains the selected Indexer's requirement
bindings, read scope, `main-index` operation, primary/additional profiles,
primary or pre-authority Provider layers and customization mode. It excludes
`profile.composers[]` and Provider layers used only after primary authoring.
`context.indexer.primary-execution-projection/v1` separately binds the primary
program, instructions, templates, config, CLI/profile contracts and only
`primary | pre-authority` resources. Its resource subprojection produces
`primary_resource_binding_digest`; a post-author resource cannot satisfy that
schema.

`context.indexer.main-workset/v2` digests its complete canonical payload. A
workset set permits only one author workset for an Indexer, owner cohort and
group key. `context.indexer.main-transport-batch/v2` may carry several complete
worksets but intentionally has no batch identity, digest, page number or
reader-facing name. Regrouping worksets for Host transport therefore cannot
change an individual workset or Result identity.

Each partition run request also carries one exact
`partition_strategy_attempt`: its resolution order, strategy reference and
digest, plus the previous attempt digest after a retry. The field participates
in the execution request digest and is `null` for author work. Context accepts
only a semantic partition. Ordinal, fixed-count and alphabetical axes are
recorded in a content-addressed convergence chain and atomically requeue the
same workset with the next authorized strategy. This path has no user Gate and
does not consume profile-revision attempts; an exhausted strategy set routes
to the CLI catalog fallback.

Context projects every source-specific fact, dependency and verified Provider
fragment authorized for one main workset into the single
`context.indexer.authorized-workset-view/v1` resource. The Agent reads that
managed resource and does not construct source-specific reads, cursors or
receipt fields. Internally, Context uses
`context.indexer.workset-read-request/v1`: the stable request identity binds the
current workset, read kind and exact authorized ref set, while cursor and page
size remain transport-only. Every page carries a canonical payload digest, and
the CLI closes the complete acyclic chain into
`context.indexer.workset-read-receipt/v1` with exact coverage. The Host binds
that CLI-issued receipt set to the main Result before operation validation;
Provider-authored receipt values are ignored. Changing a cursor, page size,
call grouping or Host batch cannot manufacture a new logical unit such as
`batch-1` or alter an Artifact identity.

Post-author composition uses its own
`context.indexer.post-author-run-ledger/v1`; it never reuses primary main-run
progress. Each entry is keyed by composer ref and current workset digest and is
`pending`, `running`, `accepted`, `failed` or `stale`. An accepted entry stores
the complete validated Result, materialized fragments and invocation receipt,
including a valid zero-fragment Result. Rebuilding a workset set reuses only an
accepted entry whose workset, request, View, Result, receipt and fragment set
all remain current. A `running` entry without that complete record returns to
`pending` on recovery; a changed workset becomes `stale` without discarding
unchanged accepted peers.

`context.indexer.post-author-status/v1` exposes deterministic total, pending,
accepted, failed and stale counts, sorted next refs and the accepted receipt-set
digest. Zero effective composers yields `post_author_envelope.state =
not-required` without creating a View or envelope and may reconcile. A nonzero
set may reconcile only when every composer is accepted and the supplied
`context.indexer.composed-result-envelope/v1` exactly matches the recomposed
current envelope. Missing or mismatched envelope data is `stale`; partial,
failed or stale worksets cannot reconcile.

## Parser coordinates and locks

A runtime profile declares each parser as a
`context.indexer.parser-requirement/v1`: an abstract capability, parser ABI and
exact community package/export/version coordinate. The capability name is not
an import alias and the presence of parser source in a Context or downstream source mirror
does not prove that the capability is installed.

The configured registry resolves that requirement to
`context.indexer.parser-coordinate-mapping/v1`. A direct mapping preserves the
community coordinate exactly. A wrapper may use another coordinate only while
preserving the same ABI digest; it may re-export the ABI but cannot redefine
parser facts. Installation then produces
`context.indexer.parser-resolution-lock/v1`, which records the actual
package/export/version, mapping digest, lock integrity, resolved content digest
and ABI digest.

Provider or local-customization imports must carry the exact capability and
parser lock digest and must import the actual locked package/export/version.
The locked dependency projection feeds controlled execution and stale
identity. Community aliases, mirror paths and whether a sync copied parser
source are not accepted as runtime evidence. Internal release smoke must load
the configured actual export; that later release check does not change this
protocol authority.

## Section collection mapping and layout

Collection remains the closed package and query classification vocabulary. A
Provider Result declares only each Section's `section_key`, owner Indexer,
document kind, reader goal and Artifact kind. The selected CLI profile contract
owns the versioned `layout_mappings`; exactly one mapping must match the
profile, source role and complete Section projection. A Result containing a
collection, output path or unknown top-level package namespace is invalid.

Collection belongs to a physical Artifact. Every actual or material-gap
Section in that Artifact must resolve to the same collection. A mixed source
may route different Sections to different collections only by declaring
separate Artifacts in its validated Bundle; the CLI does not silently split or
merge reader pages to repair a Provider Result.

The compile-internal resolver emits `context.indexer.layout-proposal/v1`. It
binds the exact Artifact Result, profile contract, validated SubjectKey schema
set and exact schema digest, Indexer and source. The resolver validates the
SubjectKey against the selected schema normalization before deriving NodeRef;
a caller-supplied digest is not accepted as schema authority. NodeRef plus the
logical Artifact id/kind derives ArtifactRef. NodeRef, owner Indexer, Artifact
kind and Section key derive a stable logical Section identity; its placement
under one Artifact derives SectionRef. This lets a diff distinguish a moved
Section from new content without allowing the same logical Section to have two
primary placements. The ViewRef is an internal projection. Output paths are
derived under `knowledge/<collection>/` and never accepted from a Provider.

Template Artifacts enter layout only after validated rendering. Only rendered
Sections exist; an omitted optional projection does not create an empty
Section, while a retained material gap remains unresolved without
reader-visible placeholder content. Artifact Bundle purpose and `split_of`
lineage are retained in the proposal. A proposal set rejects duplicate Node
owners, Artifact identities, logical Section identities, Section placements
and output paths across Indexers, as well as missing, nested or kind-changing
semantic-split parents.

Before Candidate Review, Context builds
`context.indexer.artifact-manifest/v1` from the current layout set and the
actual physical Markdown set. The manifest stores paths, content digests,
byte/body-line counts and exact logical-unit or registered-navigation ownership;
it does not retain the Markdown body. A separate
`context.indexer.physical-artifact-audit/v1` recomputes Bundle numerator and
denominator, per-unit physical fan-out, semantic split count, and the complete
missing/empty/orphan/unresolved-material sample set. Any such diagnostic is a
non-overridable completeness failure.

Generated navigation must use a content-addressed
`context.indexer.navigation-artifact-plan/v1`. Nested navigation is allowed,
but every navigation Artifact must reach a logical-unit Artifact; unknown
children, cycles, path collisions and unregistered files fail. Reader bodies
over 1500 lines produce a non-blocking advisory only. Total physical Artifact
count has no global maximum.

An initial layout does not create a structural Gate. A content-only increment
reuses the existing Artifact identity and also skips the Gate. Adding reader
fan-out to an already approved Node, removing or renaming an Artifact,
splitting/merging its declared lineage, moving a logical Section, or changing
an approved collection/path is represented by a digest-bound layout change
report and requires the human, non-delegable `confirm-layout-change` Gate.
`context.indexer.layout-transition/v1` binds the current proposal set and base
projections before exposing the conditional Gate. The legacy align Route remains
available only until the workflow cutover; it is not an authority for the new
Indexer protocol.

## Explicit Result-bound Candidate compile

`compile-indexer-candidates` consumes the complete current set of accepted
author Results from the durable main-run store. Its input repeats only the
exact workset, execution-request, acceptance and Artifact Result digests; the
CLI rejects a missing, extra, forged or stale Result reference before
materialization. Callers cannot provide an alternate Result body, Provider
contract, default plan or prose-compile payload.

The compiler validates every accepted run envelope and acceptance record,
then binds each Candidate to the same Indexer Result, source identity,
Provider layer and integrity, Bundle digest, configuration fingerprint and
optional customization fingerprint used by layout. The supplied layout
proposal set and transition must bind the same Artifact Result set. Any
destructive layout report additionally requires its exact non-delegable
confirmation; unresolved material gaps stop compile.

Structured Section blocks are materialized directly. Template-backed
Artifacts use only an exact rendered Artifact bound to the same Result digest.
The CLI derives physical paths from layout, builds the physical Artifact
manifest, and requires the completeness audit to pass before returning the
Candidate set. The durable current record lives under Context runtime state;
it does not write approved knowledge. Review and apply remain the only route
to approved Markdown.

No generic fallback exists after Provider resolution. A minimal local
customization may be proposed only after the explicit
`indexer-customization-required` outcome and its capability-gap proof; compile
itself never invents one.

## Material-gap recovery and the single authoring path

Reconciliation emits unresolved material gaps when current authorized sources
cannot satisfy a required question. `checkpoint-material-gaps` stores only the
current unresolved set in Context runtime state under `.tmp`, with a revision
for crash recovery and stale-write rejection. It does not persist answer text,
source spans, approval receipts, or audit history into knowledge files.

Newly captured Markdown, tool snapshots, or other authorized material re-enter
the normal `main-index` operation. The next main Result either answers the
question from current source or leaves the gap unresolved. There is no separate
answer workset, answer-only Result, evidence Review, planned landing, or layout
actualization. Users review the resulting knowledge Candidate once.

`audit-material-gap-state` recomputes the expected unresolved set without a
write. Required gaps block close; optional gaps remain runtime diagnostics.
Successful close writes only approved knowledge structure and clears completed
runtime lifecycle state.

## Detector and inspector

An activation detector consumes `context.indexer.activation-request/v1`. The
request contains the exact declared required, supporting and negative signal
set plus one `context.indexer.parser-fact-view/v1`. The view is built from
validated Evidence Adapter Results and their process-local structured fact
payload sidecars. It binds the authorized source/module scope, canonical file
inventory, origin Result digests and every payload digest. Raw source or
configuration text is not part of this input.

Parser adapters expose a materialization helper that returns the wire-safe
`context.indexer.evidence-adapter-result/v1` together with `fact_payloads`.
Those payloads intentionally do not serialize inside the Result and cannot be
recovered after a JSON round trip. The caller must construct the parser fact
view while the sidecar is still present; missing, extra, stale or out-of-view
payloads fail closed.

`context.indexer.activation-result/v1` must close every signal as
`present`, `absent` or `unknown`; a present signal requires evidence. Context,
not the detector, derives `matched`, `not-matched` or `indeterminate`.

An authoring inspector consumes `context.indexer.inspector-request/v1`, including
the exact active Provider profiles and Registry variants, and returns
`context.indexer.inspector-result/v1`. Its evidence payload is the shared
`context.indexer.evidence-adapter-result/v1`; its `fact_payloads` carry only
validated profile variants, source Fact refs, bounded template variables and a
structured availability status. Context requires one payload for every
enrichment fact, verifies each payload digest and source ref, rejects Registry
variant drift, then adapts the values into the same internal Authorized Workset
View projection source used by other inputs. Inspector files are always
`enricher` plus `lightweight-evidence`; they cannot own baseline inventory or
contribute a denominator. The Result must close the requested inventory and
authorized source/module scope. No Inspector protocol or technical identifier
is exposed as a separate Agent input. Detector and inspector entries run only from
the reverified content-addressed stage through the same empty-environment,
no-shell, bounded JSON subprocess runner. Timeout, stdin/stdout/stderr overflow,
invalid UTF-8/JSON, undeclared evidence and scope expansion are typed failures;
a successful execution returns a digest-bound receipt.

## Project-local customization

A Provider-only project does not create `src/indexer/`. When the registry
explicitly selects `extend` or `replace`, Context reads only
`src/indexer/<indexer-id>/` and the fixed resources `index.ts`, `variables.ts`,
`helpers.ts`, `instructions.md` and `templates/<id>.md`. Each file requires an
exact `@context-indexer-origin` header. `replace` additionally requires a current
capability-gap proof.

Every customization view also carries a validated
`context.indexer.customization-plan/v1`. The fixed escalation ladder is
`provider-only`, `config`, `instructions-append`, `template-override`,
`program-extend`, then `replace`. Selecting a step requires ordered evidence
that every smaller step is insufficient. `replace` additionally requires three
distinct failed extension-attempt digests and human confirmation; adding an
external dependency also makes confirmation mandatory. The selected step must
match the actual loaded files and the registry's `none | extend | replace`
mode. A Provider-only workspace gets a deterministic `provider-only` plan and
must not supply a local escalation plan. A non-empty registry config remains
registry-only but requires an exact `config` plan with Provider-only closure
evidence.

Project changes are represented by
`context.indexer.project-proposal/v1`. A proposal binds the unchanged
requirement-set authority, complete target registry, actual changed files,
fixed dependency intents, validation reports and expected-base digests. It is
staged under runtime state before any source write. Applying it uses the project
write lock and a persistent multi-file journal; recovery accepts only complete
base or target file states and refuses unknown external drift.

Dependency intents begin as `requires-authorization` and cannot make a proposal
apply-ready. The separate `authorize-indexer-dependencies` Gate requires the
`context.indexer-dependency-install` authority and binds the proposal, original
intent-set digest, exact package versions, importers, lock integrity, resolved
content digests and authority scope. Its CLI Action returns a digest-bound
authorization receipt plus a new `locked` intent set; install scripts remain
structurally `false`. A locked intent without its exact receipt, an unused
receipt, a changed resolution or an ordinary managed authority fails closed.
The Agent must use that locked set and the complete package/lock snapshots in a
replacement staged proposal before `apply-indexer-project`; the apply journal
never writes `node_modules`, which is reconstructed only from the accepted lock.

## Indexer template rendering

Indexer authoring templates are not package-output Handlebars templates. Each
Provider template is one manifest-declared Markdown file under that Provider's
`templates/` tree. A project may replace only the same template id/profile at
`src/indexer/<indexer-id>/templates/<id>.md`; all other templates continue to
come from the verified, content-addressed Provider stage.

The Markdown file begins with closed YAML frontmatter using
`context.indexer.template/v1`. It declares the reader goal, applicable artifact
policy variants, typed variables with an explicit `deterministic-fact` or
`semantic-prose` content layer, registered deterministic blocks, required and
optional Sections, question refs, evidence kinds/cardinality, deletion rules,
page-boundary guidance, anonymous examples, anti-examples, forbidden output and
a rendered byte budget. Every body Section uses exact markers:

```md
<!-- context:indexer-section summary -->
# {{variable:title}}

{{variable:summary}}
<!-- /context:indexer-section -->
```

Only `{{variable:<id>}}` and `{{block:<id>}}` are accepted. Direct variables are
semantic prose. A block source variable is a deterministic Fact projection,
must bind canonical `fact_refs`, and must equal the CLI's normalized projection
of those Facts. Blocks select one of
the CLI-owned `bullet-list`, `key-value-table` or `json-code-block` renderers;
templates cannot register code or helpers. A block directive occupies its own
template line so the renderer can retain an exact content-layer boundary. The
contract and body must declare exactly the same Sections and placeholders.

`ArtifactResult` binds every template variable to current evidence refs and
binds every declared Section to `section_key`, owner Indexer, document kind,
reader goal and Artifact kind. Rendering validates the Provider/customization
fingerprints, template digest, current CLI-owned applicability conditions,
variable types and expansion limits, per-variable evidence boundary and exact
CLI-owned question target. An optional Section without data
or sufficient evidence is absent from the rendered Candidate. A required
Section in the same state becomes the already-declared material-question
transition and makes `review_ready` false.

Before a Candidate can enter Review, Context rejects unknown directives,
unresolved variables, template comments, example placeholders, standalone or
bracketed `TODO`/`TBD`/`待补充`/`待生成` markers, title-only Sections and budget
overflow. A source-backed sentence that discusses a known TODO is not treated
as a placeholder merely because it contains that token; it remains semantic
prose and therefore requires Agent Review. The rendered
Section content, ordered content-layer ledger and evidence receive stable
digests. Deterministic blocks contribute catalog completeness but never
semantic-prose density. Later `build` projects this approved body; it does not
perform a first render or change its structure.

An ArtifactResult may emit
`context.indexer.structured-claim-set/v1`. Every claim binds a stable claim
kind and subject to one real Artifact/Section owner and one or more evidence
refs carried by that exact Section. The subject must be the current logical
unit, one of its CLI-owned inventory members, or an authorized target-resolution
identity. Missing owners, outside subjects, unknown evidence and evidence that
is known globally but absent from the owner Section all fail Result validation.

Main-run validation derives
`context.indexer.generated-authoring-audit/v1`. It reports controlled generated
placeholder and empty emitted-Section hard findings, proves that every emitted
structured claim passed owner-local evidence coverage, and lists every
semantic-prose block or direct authored template variable as
`semantic-prose-agent-review-required`. It does not scan free prose to claim
that unsupported natural-language assertions were mechanically detected.

## Material-question target exclusion

A target exclusion is not a Provider Result and does not change the confirmed
requirement. Context first emits
`context.indexer.material-question-exclusion-report/v1` for one current
unresolved `QuestionTargetKey`. The report binds the project, predecessor
ledger revision, question-target inventory, question contract and revision,
target ref/item digest, exact allowlisted reason, derived severity and the
reader-visible impact.

`confirm-material-question-exclusion` accepts only that report and always emits
`context.indexer.material-question-exclusion-confirmation/v1` with human,
non-delegable authority. Managed mode, Provider omission, wildcard targets and
non-allowlisted reasons cannot create the decision. Apply revalidates the
report against the current resolved question and ledger before retaining only
the reason code and decision digest in the entry.

The successor ledger is checkpointed with the predecessor revision through the
same durable structure journal. A question contract, owner, target item,
question revision or other pair dependency change replaces the retained
exclusion with an unresolved entry in one checkpoint. The Material Gap ledger
is intentionally absent from the main-workset identity, so this target-level
decision does not invalidate unrelated main indexing worksets.
