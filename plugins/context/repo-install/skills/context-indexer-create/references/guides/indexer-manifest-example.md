# A minimal Provider manifest

This is the smallest `context-indexer.yaml` that validates. Start from it and add
only what your bundle implements. Reading an installed Provider's manifest is
still worthwhile for behavior, but do not copy its declarations wholesale: they
describe that bundle's resources, not yours.

```yaml
protocol: context.indexer.provider/v1
id: context-example-indexer
version: 1.0.0
domains: [markdown]
activation:
  target_kinds: [document-set]
  required_signals:
    - id: prose-source
      description: The target contains prose a reader would consult.
  supporting_signals: []
  negative_signals: []
provides:
  profiles: [reader-guide]
  operations:
    - id: main-index
      consumes: context.indexer.main-workset/v2
      produces: context.indexer.main-result/v1
provider:
  instructions:
    - path: references/indexer.md
      profiles: [reader-guide]
  templates:
    - { id: guide, profile: reader-guide, path: templates/reader-guide.md }
customization:
  supports: [instructions-append, template-override]
```

The three groups below are the reason this file exists: a field being absent from
a manifest means something different depending on which group it belongs to.

## Required

The schema rejects a manifest missing any of these.

- `protocol`, `id`, `version` — the protocol literal, a discoverable Provider
  identity, and a semver version.
- `domains` — at least one. Note and Sessions Providers use `markdown`.
- `activation.target_kinds` — at least one. This is projected into the Provider
  selection catalog, so it decides when your Provider can be selected at all.
- `activation.required_signals` — at least one `{ id, description }`.
- `activation.supporting_signals`, `activation.negative_signals` — the arrays
  themselves are required; an empty array is the normal value.
- `provides.profiles` — at least one. A profile whose id contains `/` is a
  namespaced extension profile and additionally requires a matching
  `composition.extensions` entry.
- `provides.operations` — at least one. `main-index` is the only operation.
- `provider` — at least one of `program`, `instructions` or `templates`.

## Required once you declare a capability

Declaring a customization capability without the resource that implements it is
rejected at manifest validation:

- `customization.supports` containing `config` requires `provider.config_schema`.
- `customization.supports` containing `program-extend` requires
  `provider.program`.

Both inconsistencies used to surface only at use time — a non-empty config while
validating the selection, `program-extend` while preparing the customization
project. Declare only the hooks your bundle actually backs; `instructions-append`
and `template-override` need no additional resource.

Two related rules hold for every resource. Each `instructions` and `templates`
entry must name a profile that `provides.profiles` declares, and every declared
path must exist inside the bundle. The reverse also matters: a reference file
that no entry declares is never delivered to the Agent, so adding a file is not
the same as making it available.

## Optional, and not uniformly enforced

These are accepted and carry authoring intent. It is worth knowing which ones
have a consumer, because declaring a field is not the same as gaining a check.

- `quality_guidance.metric_ids` and `quality_guidance.repair` — read when
  projecting Provider contract references; the repair path ships as a resource.
- `activation.agent_questions` — questions this Provider wants asked before it
  interprets material.
- `provides.partition_strategies`, `provides.logical_units`,
  `provides.composers`, `composition.extensions` — declare only what you
  implement. Priorities must be unique per profile, and a composer contract
  requires a post-author `derived-artifact-proposal` layer fragment.
- `provider.completion_checks`, `provider.forbidden_fallbacks` — the schema
  accepts and deduplicates them, and no execution consumer reads them today.
  Declaring them records intent for a reader of the manifest; it does not add a
  runtime check, and omitting them does not remove one. Material gaps in
  particular are handled by result reconciliation, which does not read
  `completion_checks`.

## Validate it

Use the installed SDK, as described in [the authoring
guide](indexer-skill-creation.md). `parseIndexerProviderManifest` accepts the
manifest text directly, which is enough to confirm the field tree; loading the
bundle directory additionally confirms that declared resource paths resolve.
Neither establishes that the Provider produces useful pages.
