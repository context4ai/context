---
id: context.code-indexer.template.plugin-extension
kind: procedure
media-type: text/markdown
---

# Plugin and extension boundary template

Use for `plugin-extension`. This file owns the complete plugin contract
blueprint. CLI, SDK, and adapter templates should point here and only add their
module-specific command, public API, or mapping context.

## Evidence pass

Locate:

- discovery mechanism, manifest, registry, or installation contract;
- activation, deactivation, update, and removal lifecycle;
- contribution points, commands, hooks, providers, and host services;
- configuration, identity, compatibility, permissions, and isolation;
- failure containment, fallback, diagnostics, and version negotiation;
- public extension API and maintained examples when consumers implement it.

## Questions the knowledge must answer

1. How does the host discover, install, and activate an extension?
2. What may the extension contribute or call?
3. Which configuration, identity, permission, and compatibility rules apply?
4. How are failures isolated, surfaced, and recovered?

## Chapter blueprint

```markdown
# <Plugin boundary>
## Host and extension responsibilities
## Discovery and installation
## Activation and removal lifecycle
## Contribution and capability contracts
## Configuration, permissions, and isolation
## Compatibility, failure, diagnostics, and recovery
## Source-backed host-to-extension relationships
```

## Granularity and stop conditions

Prefer one contract per host/extension model, with compact records for coherent
contribution families. Do not create separate copies under CLI, adapter, and
SDK pages. Every page must name concrete manifests, registries, hooks, or
capability identities and their source locators.

Revise or stop when discovery or activation is inferred, permissions and
isolation would be guessed, or examples describe an unsupported extension API.
