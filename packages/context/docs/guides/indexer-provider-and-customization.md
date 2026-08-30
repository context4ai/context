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

1. Inspect and confirm the complete `IndexRequirementSet`. A Provider,
   registry entry or Result may strengthen it but cannot remove targets,
   questions, evidence obligations or required owner cells.
2. Run `context indexer catalog --format json` and report those CLI-bundled
   entry Skills together with Indexer Skills already visible to the Host.
   When the Host exposes an exact Skill root, read only its `SKILL.md`
   frontmatter and sibling `context-indexer.yaml`; the manifest version is
   authoritative and `metadata.context-provider-version` must match it. Group
   the same Skill name and exact version into one conversational item with all
   observed source types. An installed projection of an identical CLI-bundled
   identity is not a second Provider; different versions remain distinct. Do
   not scan `.claude`, `.codex`, `.agents` or arbitrary user directories.
3. Route the path-free visible identities with
   `context indexer route-indexer-provider-selection`. Try the applicable
   community fallback once when the Route requests it.
4. Statically validate the returned selection proposal before a Host resolves
   any Bundle. Resolve only the emitted exact requests, then stage and validate
   the complete content ledger.
5. Apply the registry and any declared customization through the staged,
   CAS-bound project proposal. A successful static report is not write or
   execution authority.

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

Use `--help` for the current payload schema and copy Route-returned commands
when available:

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
