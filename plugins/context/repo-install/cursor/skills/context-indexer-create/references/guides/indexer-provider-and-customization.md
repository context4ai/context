# Indexer Provider selection and customization

This guide is for workspace users and Agents selecting Code, Markdown, Note or Sessions
Indexer Providers. Provider authors should also read the dedicated
[Code Indexer](./code-indexer-skill-authoring.md) or
[Markdown Indexer](./markdown-indexer-skill-authoring.md) authoring guide.

Context is registry-only by default. The durable selection lives in
`src/indexers.yaml`; `package.json`, discovered Skill paths, Host cache paths,
resolved transport paths and runtime staging directories are not selection
authority. A Provider-only project does not create `src/indexer/`.


## Large sources and planning depth

Use directory/manifests, route or service registration and representative code to
select Providers and plan reader subjects. Do not run a complete symbol index
just to decide the initial article menu. Application/service file-inventory
batches describe reading scope; they are not business module boundaries or a
requirement to publish one article per directory. Inspect the supplied source
access and converge related batches into reader subjects. A file with no supplied
symbol facts has not been deeply parsed; this is not evidence that it has no APIs.
Accepted application batches acquire parser facts before Author. Existing
request-material remains the next action for implementation outside the initial
reading scope. Public-contract-led profiles, including component libraries,
retain their contract preparation because those facts define their reader targets.

A read scope is an authorization ceiling. Each Indexer should own its actual
module, with other sources as supporting evidence only when needed. Mixed
frameworks require per-module Provider choices; do not disable a relevant
extension to avoid fixing an oversized source boundary. Framework facts are
still prepared at Author after the selected code has been parsed. For large
IDL sources, first follow the selected applications' concrete protocol references
and required includes; an entire protocol monorepo is not a default target.

Parser progress is on stderr; stdout remains the command's JSON result. Report
actual phase, source and available counts without estimating a percentage from
elapsed time. A preparation-cache hit only reuses parser work, not proof of
completed articles. After interruption use the current Route; do not clear state
or increase memory automatically to retry the same oversized scope.

## Selection flow

Follow `workflow.current` from `context status --format json` or `context run`.
When the registry is missing, the Route names `src/indexers.yaml` in
`configuration`: declare the confirmed requirements with `indexers: []`, then
re-evaluate. The next Route supplies the Provider selection input and completion
command. An unconfigured project does not begin Partition or require a fabricated
primary owner. `run --managed --until blocked-or-complete` stops at the same
configuration or semantic input boundary; it does not make those decisions.

1. Form the complete requirements using the initial registry contract below.
   Reuse the user's stated meaning and research the selected material. Ask about
   consequential missing purpose or scope even in managed mode; delegation
   covers execution and eligible reviews, not unanswered intent. A Provider,
   registry entry or Result may strengthen it but cannot remove targets,
   questions, evidence obligations or required owner cells.
2. Select applicable Providers from the Host-visible Skills and the CLI-bundled
   catalog already in the current Action input. No separate catalog command,
   installed-Skill inventory, discovery report, or discovery-only confirmation
   is required. Use the supplied exact identity and cli-bundled distribution
   for shipped Providers, even when their Skills are also visible to the Host.
   For a relevant external Skill, read its exact Host-exposed `SKILL.md`
   and sibling `context-indexer.yaml`, then only the linked framework references
   needed to evaluate observed module signals. Do not guess versions
   or scan `.claude`, `.codex`, `.agents` or arbitrary user directories. Different
   versions remain distinct; discovery order is not selection precedence.
3. Submit the semantic `indexers` and any relevant non-CLI `host_visible_skills`
   through the current Route's `context action complete-current` command. The
   latter may be empty; it is not an inventory or an additional discovery step.
4. The CLI performs routing, validation, resolution and staging internally.
   Shipped Providers load directly from this CLI release; only external
   Providers may require the returned Host resolution Action. Follow the
   current Route if a distribution is missing, a version conflicts, or program
   execution needs authorization. Do not call the low-level commands below as
   a second production workflow.
5. The CLI atomically applies the validated registry and any declared
   customization. A successful static report alone is not write or execution
   authority. Resume from the returned current Route.

Every required requirement/domain/source/module cell has exactly one primary
owner. Read scope may overlap for supporting profiles, extensions and
enrichers. Array order is never precedence. Each Provider layer retains its own
exact version, integrity, portable distribution, config and resource
fingerprints.
For CLI-bundled instruction Providers, these fields record the original
selection; they are not a requirement to reinstall old bytes when resuming.
The current CLI supplies its installed Provider's guidance automatically.

### Select technology profiles per module

A registered repository is a source boundary, not a single technology profile.
Different modules may need different primary profiles and extension layers. Use
the current selection contract's supported module and target/read scopes; never
assign one module's stack to the entire repository merely because it was
registered as one source.

An observed framework dependency, configuration, entry or adapter signal is a
reason to load the relevant Provider Skill and its applicable reference during
selection. Reading this guidance is not activation or permission to execute the
Provider. Follow its evidence rules to verify the signal within authorized source
material, then bind the applicable profile only to the supported modules. A name
alone may justify investigation without proving a framework is active.

If boundaries are still unclear, identify the relevant modules and inspect their
configuration and entries in the existing selection flow. Do not reject a
relevant Provider solely because the repository contains mixed stacks, or defer
investigation until generic authoring happens to report a capability gap. Record
unresolved evidence and the concrete next inspection when it cannot yet be
obtained. Keep unrelated modules on their appropriate primary profiles; multiple
compatible, proven extensions may support one module without becoming duplicate
primary owners. These are Agent selection responsibilities, not CLI semantic
checks or new review gates.

## Resuming after a tool update

Continue with the current Route and its supplied source material. Agents do not
compare Provider, Fact, signature or inventory fingerprints and do not rewrite
them in an old request. Context rebuilds the internal result from the submitted
page content and references.

An added parser field or a more complete line range in the same unchanged file
does not invalidate Author work. Continuation compares selected sources and
subjects rather than serialized Fact payloads; accepted work retains its
original request/result pair. New results retain the source references used for
later updates. Repeated Fact references or reader-question answers are deduplicated;
multiple sections may answer the same question. A question ID only identifies a
reader question to cover, not an additional user approval.

Missing references, a changed source file, a different page owner/subject or a
concurrent write remain meaningful conflicts. Requirements, membership and result
contracts still determine whether a task can be reused. This does not introduce a
new Agent protocol, hash-entry step or persistent audit file.

## Provider selection result

Use the current Action's output schema, which defines the accepted Indexer
entry fields. This is a `complete-current` input, not a replacement registry
and not the requirements-only bootstrap schema.

For one component-library requirement, the following template selects one
primary Code Provider. Replace the quoted placeholders using the **current
Action input**, not values from a different CLI installation:

```yaml
stage: provider-selection
host_visible_skills: []
indexers:
  - id: component-guide
    operations: [main-index]
    requirement_bindings:
      - requirement_ref: "<requirement.id>"
        coverage_domains: ["<required-domain>"]
        owned_scope:
          ref: "requirement:<requirement.id>#target_scope"
        role: primary
    read_scope:
      refs:
        - "requirement:<requirement.id>#target_scope"
        - "requirement:<requirement.id>#evidence_source_scope"
    profile:
      primary:
        id: component-library
        provider: community
    providers:
      - id: community
        role: primary
        catalog_skill: "<catalog.skill>"
```

- Choose `component-library` only if it matches the reader task and appears in
  the selected catalog entry's `capabilities.profiles`. For captured documents,
  notes or conversation summaries, select a profile from the corresponding
  compatible Provider. `catalog_skill` selects exactly one bundled entry from the
  current Action catalog. The CLI fills its version, integrity and distribution
  after checking the Route revision; a changed catalog invalidates that revision.
  Do not combine this reference with identity overrides. Full identities remain
  available for explicitly pinned entries and external Providers, which retain
  their resolution and authorization requirements. The persisted registry always
  contains complete identities, never `catalog_skill` references.
- Bind each selected requirement and all required coverage domains it owns;
  the single-domain template is not permission to drop other required domains.
  `owned_scope` names the target being described. `read_scope` may also include
  supporting evidence, which does not become another owned target.
- `profile.primary.provider`, each additional profile's `provider`, and each
  composer's `provider` reference a layer's `providers[].id`, not a Skill path.
  Supporting or extension profiles use `profile.additional` with `kind`;
  composers use `profile.composers`. Select only combinations supported by the
  manifests; do not add empty customization or speculative config.
- The current catalog includes domains, target kinds, profile IDs, operations,
  composers and extension relationships. If more detail is needed, read the
  selected entry's exact `guidance.skill_path` and `guidance.manifest_path`.
  These paths and capabilities are reading aids, not fields to copy into the
  persistent registry. No separate discovery command or cache scan is needed.
- JSON Schema describes input shapes and accepted values. The CLI additionally
  checks coverage ownership, scope relationships and Provider composition when
  submitting. It atomically applies the selection; do not edit `indexers`
  manually to bypass a rejected result.

## Initial registry: `src/indexers.yaml`

The initial configuration Route provides the registered source boundary view.
Read it when the source identities are not already available from the current
source registration results. It is a metadata view, not another source capture
or a request to scan the repository. Use only the user's agreed source scope.

Read the `context.indexer.registry-bootstrap` schema at the exact path in the
current Route's required resources. It ships with the CLI, so it does not
require a workspace SDK reinstall. It describes this **configuration file**,
not an Action completion payload. It
covers the requirements-only state before Provider selection: `indexers` must
be empty here. Later the Provider selection Route fills that array.

Start with this complete YAML example. Replace the example source reference,
reader goals and coverage domains with the agreed project requirements:

```yaml
protocol: context.indexer.registry/v1
requirements:
  - id: component-guide
    purpose: Help application developers integrate components and look up their public API.
    reader_goals: [understand-components, integrate-components]
    coverage_domains:
      component-usage: required
      public-api: required
    target_scope:
      targets:
        - source_ref: repo:20260901/component-library
    evidence_source_scope:
      targets:
        - source_ref: repo:20260901/component-library
indexers: []
```

| Field | What to write |
| --- | --- |
| `protocol` | Exactly `context.indexer.registry/v1` for the file. |
| `requirements` | One or more knowledge goals, grouped by reader need; not one entry per file or symbol. |
| `id` | A unique, readable identifier for this requirement. |
| `purpose` | Optional short natural-language reader and task purpose; reuse explicit existing goals when absent. |
| `reader_goals` | One or more readable goal identifiers, such as `integrate-components`. These are not Provider names. |
| `coverage_domains` | A nonempty map of intended information categories to `required`, `optional` or `out-of-scope`. Provider selection must cover the required categories. |
| `target_scope.targets` | Sources whose subjects the knowledge should describe. At least one target is required. |
| `evidence_source_scope.targets` | Sources the Agent may read to support that knowledge. Include the relevant target sources and any agreed supporting documents. At least one is required. |
| `source_ref` | The source type plus its complete registered name, such as `repo:20260901/component-library`, `file:20260901/usage-guide` or `lark:20260901/faq`. Saved text uses `note:20260908/topic.md` or `sessions:20260908/topic.md`. Preserve the actual name, not these examples. |
| `module_refs` | Optional on each target; omit for the complete registered source boundary. Supply only known module references for an explicitly narrower scope. Do not invent a module merely because the source is a code module. |
| `questions` | Optional structured contract-question bindings, not free-text user questions. Omit unless an actual CLI/profile contract supplies their references, versions and digests. Never invent hashes. |
| `exclusions` | Optional explicit exclusions with `id`, `scope.targets` and a nonempty `reason`. For repository input, optional `paths` lists exact source-relative files or directories, without globs; omitted means the whole named scope. Agreed paths are filtered before Parser and Partition. A shared Indexer retains material still needed by another requirement. Omit when none were agreed. |
| `indexers` | `[]` until the next Route selects Providers. Do not copy version or integrity values from an unrelated project. |

Requirement, goal, domain and exclusion identifiers use lowercase letters,
digits and `._/-`; the first character is a letter or digit, and slash-separated
segments cannot be empty, `.` or `..`. Requirement ids and goal lists must not
contain duplicates. Each scope lists a source once; put its selected modules in
that target's `module_refs` rather than repeating the source.

For document-only knowledge, use the selected captured `file:` or `lark:` source,
or saved `note:` or `sessions:` source, in both scopes. Saved text must first be
explicitly selected in the project's `sources`; saving alone is not selection. For a code guide supported by a FAQ, keep the code source in the target
scope and include both code and FAQ in the evidence scope. If the FAQ also needs
independent knowledge coverage, include it as a target in the appropriate
requirement; do not silently treat all captured documents as background.
Source references identify selected source boundaries, not filesystem paths, URLs,
image ids, span references or content digests. A repo source already registered
at a package subdirectory remains bounded to that subdirectory when
`module_refs` is omitted.

Three existing input shapes have different roles:

- `src/indexers.yaml`: `protocol: context.indexer.registry/v1`, `requirements`,
  and `indexers`.
- `IndexRequirementSet`: `protocol: context.indexer.requirement-set/v1` and
  `requirements` only. This is the SDK's requirement value, not the whole file.
- Diagnostic `inspect-index-requirements --input`: an envelope with
  `protocol: context.indexer.requirement-inspection-input/v1`, `project_ref`
  (the workspace root) and `requirements`; optional `question_contracts` are
  only for real resolved contract questions. It does not accept the whole
  registry or a bare requirement set, and is not a mandatory bootstrap step.

After editing the named configuration file, run `context status --format json`
and follow its new current Route. The next step is Provider selection. Do not
submit the YAML through `complete-current`, fabricate a lifecycle Result,
restart the workspace or recapture existing sources.

## Six-level customization ladder

Use the first level that closes the CLI-proven capability gap. Do not start at
a more powerful level because it is convenient.

| Level | Change | Entry evidence | Exit condition |
| --- | --- | --- | --- |
| 1. Provider only | Select an existing exact Provider/profile | The confirmed requirements are fully owned by declared capabilities | Final selection validation passes and no project customization files exist |
| 2. Config | Select declared variants, resources or data-only options | The manifest exposes a closed config schema that covers the difference | Config validates; no instruction, template or program change is needed |
| 3. Instructions append | Add bounded project guidance | The gap is semantic guidance and does not change contracts, scope, identity, denominators or hard rules | Appended resource closes the gap and the origin/version fingerprint is retained |
| 4. Template override | Replace one declared template for one profile | The Artifact policy is already valid; only reader organization/rendering differs | One exact template id/profile is overridden; unrelated templates remain Provider-owned |
| 5. Program extension | Add a fixed local program under the declared indexer root | A structured algorithm is required and smaller levels are proven insufficient | Static policy passes and independent program/dependency authorization is complete |
| 6. Restricted replace | Replace only the capability named by the final gap proof | Extension cannot satisfy the exact owner cells and a human accepts the larger maintenance boundary | Replacement remains requirement-compatible, content-addressed and explicitly reviewable |

Levels 3–6 are allowed only after the Route returns
`indexer-customization-required` with a current `capability_gap_proof`. Copy the
proof into the draft unchanged. A draft cannot weaken requirements, widen
source scope, copy a parser, add an evaluator, or claim that it has been
applied. If no safe level closes the gap, stop instead of emitting a
conforming-looking file.

## Upgrade and conflict handling

For a CLI-bundled instruction Provider, resume with the installed Skill and
portable distribution. A version or content change alone does not require
Provider selection, registry edits, source capture or a restart. The CLI
refreshes the current batch's instruction resources and Route revision;
the Agent follows the returned Route without comparing fingerprints.

Compatible tasks keep their original request/result records. Instruction or
template edits do not, by themselves, discard accepted groups or authored
content. Changes to sources, requirements, executable programs, configuration,
result contracts or semantic extension inputs remain work invalidation reasons;
old results must not be relabeled as outputs of a different task.

Executable/external Providers continue using their resolved staged programs.
Updating instruction delivery does not replace executable code or grant new
execution permissions. Local customization files remain user-owned:

- An unchanged upstream resource keeps the local override current.
- A changed instruction resource outside the override refreshes guidance for
  pending work, without automatically regenerating completed knowledge.
- A changed resource under an instruction/template/program override returns
  `indexer-customization-upstream-changed`; rebase or remove the override.
- Missing, undeclared, escaping or contract-conflicting local resources return
  `indexer-customization-invalid`.
- A missing CLI-bundled Provider or selected profile/operation/composer returns
  the existing Provider selection Action, with its schema and next command.
  Captured sources and completed knowledge are retained. External distributions
  that cannot be resolved still require the existing resolution/selection flow.
- Multiple primary owners return a conflict for explicit resolution. Do not
  use discovery order or a preferred Provider name as a tie-breaker.

The optional `@context-indexer-origin <skill>@<version>` comment records where
a local customization began. It grants no trust and never bypasses revalidation.

## Outcome handling

These outcomes all point back to this guide:

| Outcome | Required next action |
| --- | --- |
| `indexer-provider-required` | Discover visible entry Skills, route a path-free proposal, and keep the requirement set unchanged. |
| `provider-unavailable` / `indexer-provider-unavailable` | Follow the current selection/resolution Action to restore the missing capability. A historical bundled content pin alone is not a failure. |
| `indexer-customization-required` | Follow the six-level ladder using only the returned current gap proof. |
| `indexer-customization-invalid` | Remove undeclared/escaping/conflicting files, then rebuild and restage the proposal. |
| `indexer-customization-upstream-changed` | Reconcile the upstream change with every affected override and rerun final validation. |

## Debugging commands

These are diagnostic/manual primitives, not a checklist for normal selection.
Use them only for an explicit diagnostic or a returned recovery. `--help`
describes command options, not necessarily the payload fields. Use the current
Route's schema and the initial registry contract above; prefer Route-returned commands:

```bash
context indexer catalog --format json
context indexer inspect-index-requirements --help
context indexer compare-index-requirements --help
context indexer route-indexer-provider-selection --help
context indexer validate-indexer-selection-proposal --help
context indexer resolve-indexer-providers --help
context indexer stage-indexer-provider-bundle --help
context indexer validate-indexer-customization --help
context indexer prepare-indexer-customization-project --help
context indexer stage-indexer-project-proposal --help
context indexer apply-indexer-project --help
context indexer observe-indexer-project --help
```

Keep full runtime reports under `.tmp/context-runtime/`. Do not persist Bundle
bytes, resolution receipts, selection discovery, run ledgers or audit reports
in `src/`, `knowledge/` or `dist/`.

## Completion check

Selection/customization is complete only when all of these are true:

- the confirmed requirement digest is unchanged;
- every required owner cell has exactly one primary owner;
- every Provider is exact-versioned, integrity-checked and staged from a
  portable distribution;
- profile variants, SubjectKey authority, config and resources pass final
  validation;
- each local change is the smallest proven ladder level and has no unrelated
  copied resources;
- program and dependency receipts exist when required and do not claim a
  sandbox the Host does not provide;
- the transactional apply observation matches every target digest;
- a final static/final selection validation passes after apply.

For the complete manifest and execution surface, see
[Indexer Provider protocol](../reference/indexer-provider-protocol.md).

## Purpose, page selection, and delivery

`purpose` is an optional short description of the intended reader and task.
Existing `reader_goals` remain valid when it is absent. Context passes this
requirement through Partition, Author, and Review; it does not classify free
text against a fixed vocabulary.

For the first production task in a new workspace, the source-boundary Route
requires `.tmp/work-start-report.md` before source registration. The current
workflow supplies `procedure.work-start-report` and `template.work-start-report`:
a readable report covering readers, purpose, source families, language, settings,
delivery outputs, first delivery and proposed organization. The Agent reads the
brief and representative authorized material with Host tools, presents the report
and resolves its missing choices before registration or capture. The CLI only
checks the Route payload references a real non-empty report and records its digest;
it does not judge prose or infer semantic decisions. Reuse and update the report
with actual Provider choices before Partition rather than adding a per-batch report.

Partition may select `artifact_intent` and `template_id` from the current
Provider catalog, along with `reader_task`, `outline`, `priority`, and
`delivery_boundary`. These choices are saved in the existing page plan and
reused by Author retries. Program templates declare `kind: page-program` in the
Provider's template resources. Only the selected program is included in the
Author View; procedure templates remain shared instructions. Workspace template
overrides retain priority over the bundled default.

Selected Code page programs append a deterministic public-contract table to the
same Candidate as its semantic explanation. Declarations provide field types,
requiredness, explicit defaults, signatures, and supported registration facts.
Missing declarations remain explicit; reference tables do not substitute for
source-backed examples, behavior, or change guidance.

The first readable delivery normally contains one to three pages. Subsequent
batches contain 30–50 pages, or a smaller final tail. Context retains accepted
Results across Review, close, and build, then continues the remaining pages.
`context run --deliver --format json` requests an earlier checkpoint. It keeps
the current approval rules. Status reports page counts and built preview paths;
Author task counts are reported separately.


## Source-specific Providers and Host switches

The default distribution includes Code, Markdown, Note and Sessions Providers.
`context-note-indexer` interprets saved records/excerpts/observations;
`context-sessions-indexer` interprets bounded conversation summaries, with or
without code associations. Their shared markdown domain reuses document reading
and profiles; it does not force all sources through Markdown's semantic policy.
See [note preparation](note.md) and [sessions preparation](sessions.md).

The host owns installation and enabled/disabled switches. Business skills may be
installed by any supported host channel. Discover relevant currently visible
`context-…-indexer…` skills and read the real sibling manifest; the prefix alone
is not compatibility proof. Declare the selected business Provider through the
existing host_visible_skills and indexers result. It can replace a default without
enabling that default. CLI validates/resolves what was declared; it does not scan
host caches or maintain a second business-skill enable registry. Respect explicit
user exclusions even when the bundled catalog contains the default.

Choose the page owner from reader need. A note may improve an existing guide,
answer a FAQ or justify a new reference topic. A session without code may justify
a decision or process guide. Neither saving nor source type requires a new page.
For a Code/Markdown page retain its primary and include the actual supporting
source in evidence/read scope. When specialized source interpretation is needed,
select a Note/Sessions extension layer and the matching namespaced profile
(`note/component-library` or `sessions/component-library`, for example) with
`kind: extension`. The manifest declares each supported base. Supporting profiles
with `kind: supporting` must come from the same primary layer. One primary writes
the final page; extension guidance does not create another production target.

Optional sessions `changes` records known commit/MR associations in the source
file. Existing structure.yaml source/section links connect knowledge to it.
Do not add per-page commit, session or Provider frontmatter. A reference is not
proof of merging/testing and does not expand source-read authorization.
