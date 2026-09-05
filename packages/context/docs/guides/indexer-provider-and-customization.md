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

1. Inspect and confirm the complete `IndexRequirementSet`. A Provider,
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

Provider upgrades never silently absorb a local override. Re-resolve the exact
version and Bundle, then compare the new Provider config, instructions,
templates, program resources, profile/SubjectKey contracts and the local
customization fingerprint.

- An unchanged upstream resource keeps the local override current.
- A changed resource outside the override makes only its dependent units stale.
- A changed resource under an instruction/template/program override returns
  `indexer-customization-upstream-changed`; rebase or remove the override.
- Missing, undeclared, escaping or contract-conflicting local resources return
  `indexer-customization-invalid`.
- An exact Provider version/integrity that cannot be resolved returns
  `indexer-provider-unavailable`; do not substitute another version or stale
  cache.
- Multiple primary owners return a conflict for explicit resolution. Do not
  use discovery order or a preferred Provider name as a tie-breaker.

The optional `@context-indexer-origin <skill>@<version>` comment records where
a local customization began. It grants no trust and never bypasses revalidation.

## Outcome handling

These outcomes all point back to this guide:

| Outcome | Required next action |
| --- | --- |
| `indexer-provider-required` | Discover visible entry Skills, route a path-free proposal, and keep the requirement set unchanged. |
| `indexer-provider-unavailable` | Restore the exact distribution or choose a new Provider through the selection Gate. Never use an approximate version. |
| `indexer-customization-required` | Follow the six-level ladder using only the returned current gap proof. |
| `indexer-customization-invalid` | Remove undeclared/escaping/conflicting files, then rebuild and restage the proposal. |
| `indexer-customization-upstream-changed` | Reconcile the upstream change with every affected override and rerun final validation. |

## Debugging commands

These are diagnostic/manual primitives, not a checklist for normal selection.
Use them only for an explicit diagnostic or a returned recovery. Use `--help`
for the current payload schema and prefer Route-returned commands:

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
