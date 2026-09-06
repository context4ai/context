# Indexer Provider selection and customization

This guide is for workspace users and Agents selecting Code or Markdown
Indexer Providers. Provider authors should also read the dedicated
[Code Indexer](./code-indexer-skill-authoring.md) or
[Markdown Indexer](./markdown-indexer-skill-authoring.md) authoring guide.

Context is registry-only by default. The durable selection lives in
`src/indexers.yaml`; `package.json`, discovered Skill paths, Host cache paths,
resolved transport paths and runtime staging directories are not selection
authority. A Provider-only project does not create `src/indexer/`.

## Selection flow

Follow `workflow.current` from `context status --format json` or `context run`.
When the registry is missing, the Route names `src/indexers.yaml` in
`configuration`: declare the confirmed requirements with `indexers: []`, then
re-evaluate. The next Route supplies the Provider selection input and completion
command. An unconfigured project does not begin Partition or require a fabricated
primary owner. `run --managed --until blocked-or-complete` stops at the same
configuration or semantic input boundary; it does not make those decisions.

1. Form the complete requirements using the initial registry contract below.
   Confirm their meaning with the user, or use the current session's explicit
   managed delegation. A Provider,
   registry entry or Result may strengthen it but cannot remove targets,
   questions, evidence obligations or required owner cells.
2. Select applicable Providers from the Host-visible Skills and the CLI-bundled
   catalog already in the current Action input. No separate catalog command,
   installed-Skill inventory, discovery report, or discovery-only confirmation
   is required. Use the supplied exact identity and cli-bundled distribution
   for shipped Providers, even when their Skills are also visible to the Host.
   For a relevant external Skill, read only its exact Host-exposed frontmatter
   and sibling `context-indexer.yaml` needed for selection. Do not guess versions
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
        skill: "<catalog.skill>"
        version: "<catalog.version>"
        integrity: "<catalog.integrity>"
        distribution:
          kind: cli-bundled
          locator: "<catalog.distribution.locator>"
```

- Choose `component-library` only if it matches the reader task and appears in
  the selected catalog entry's `capabilities.profiles`. For documents, select
  the applicable Markdown profile instead. Copy the actual catalog identity.
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
    reader_goals: [understand-components, integrate-components]
    coverage_domains:
      component-usage: required
      public-api: required
    target_scope:
      targets:
        - source_ref: repo:batch/component-library
    evidence_source_scope:
      targets:
        - source_ref: repo:batch/component-library
indexers: []
```

| Field | What to write |
| --- | --- |
| `protocol` | Exactly `context.indexer.registry/v1` for the file. |
| `requirements` | One or more knowledge goals, grouped by reader need; not one entry per file or symbol. |
| `id` | A unique, readable identifier for this requirement. |
| `reader_goals` | One or more readable goal identifiers, such as `integrate-components`. These are not Provider names. |
| `coverage_domains` | A nonempty map of intended information categories to `required`, `optional` or `out-of-scope`. Provider selection must cover the required categories. |
| `target_scope.targets` | Sources whose subjects the knowledge should describe. At least one target is required. |
| `evidence_source_scope.targets` | Sources the Agent may read to support that knowledge. Include the relevant target sources and any agreed supporting documents. At least one is required. |
| `source_ref` | The source type plus its complete registered name, such as `repo:batch/component-library`, `file:batch/usage-guide` or `lark:batch/faq`. Preserve the actual batch and name, not these examples. |
| `module_refs` | Optional on each target; omit for the complete registered source boundary. Supply only known module references for an explicitly narrower scope. Do not invent a module merely because the source is a code module. |
| `questions` | Optional structured contract-question bindings, not free-text user questions. Omit unless an actual CLI/profile contract supplies their references, versions and digests. Never invent hashes. |
| `exclusions` | Optional explicit exclusions with `id`, `scope.targets` and a nonempty `reason`. Omit when none were agreed. |
| `indexers` | `[]` until the next Route selects Providers. Do not copy version or integrity values from an unrelated project. |

Requirement, goal, domain and exclusion identifiers use lowercase letters,
digits and `._/-`; the first character is a letter or digit, and slash-separated
segments cannot be empty, `.` or `..`. Requirement ids and goal lists must not
contain duplicates. Each scope lists a source once; put its selected modules in
that target's `module_refs` rather than repeating the source.

For document-only knowledge, use the captured `file:` or `lark:` source in both
scopes. For a code guide supported by a FAQ, keep the code source in the target
scope and include both code and FAQ in the evidence scope. If the FAQ also needs
independent knowledge coverage, include it as a target in the appropriate
requirement; do not silently treat all captured documents as background.
Source references identify registered boundaries, not filesystem paths, URLs,
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
