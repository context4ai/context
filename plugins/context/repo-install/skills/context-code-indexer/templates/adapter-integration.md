---
id: context.code-indexer.template.adapter-integration
kind: procedure
media-type: text/markdown
---

# Adapter, bridge, and integration template

Use for `adapter-integration`: BFFs, protocol bridges, host integrations, plugin adapters,
compatibility layers, gateways, and translators whose stable responsibility is
to connect two boundaries. An ordinary internal helper that converts one object
is not automatically an adapter module.

Use the exact profile and Artifact policy variant supplied by the workset. For
an inbound operation surface, combine this template with the selected gateway
or protocol evidence without creating a second operation registry.

## Evidence pass

Locate both sides of the boundary and the code that joins them:

- inbound operation, event, command, host hook, or extension registration;
- outbound operation, client, plugin contribution, or runtime capability;
- authoritative input and output contract locations;
- identity, field, enum, version, and lifecycle mappings;
- authentication, authorization, credential, and context propagation;
- validation, normalization, batching, caching, fallback, and compatibility;
- timeout, retry, partial failure, and error/status translation;
- configuration, feature selection, ownership, and release entrypoints;
- generated DTOs/clients and converter helpers that should remain evidence.

Sample representative paths from each mapping family. Do not claim a mapping
from matching field names alone.

## Questions the knowledge must answer

1. Which two boundaries does the adapter connect, and who owns each one?
2. What triggers the mapping and where is it registered?
3. Which fields, identities, versions, or lifecycle states are transformed?
4. Which values pass through unchanged, default, or intentionally disappear?
5. How are credentials, context, errors, retries, and fallbacks translated?
6. Which contracts are authoritative and which artifacts are generated?
7. What compatibility obligation makes the adapter stable knowledge?

## Suggested knowledge units

- **Adapter contract**: responsibility, inbound/outbound boundaries,
  registration, ownership, and authoritative contracts.
- **Operation mapping registry**: use the canonical operation record from
  `protocol-boundary.md` and add only adapter-specific transformation fields.
- **Data or identity mapping**: only stable, non-trivial mappings that readers
  must understand; summarize generated field copies.
- **Lifecycle and failure translation**: when activation, cancellation,
  retries, partial failure, or compatibility behavior is material.
- **Cross-module execution path**: when both connected modules are registered
  sources and the chain is source-backed.

## Chapter blueprints

```markdown
# <Adapter> contract
## Responsibility and connected boundaries
## Activation or registration
## Inbound contracts
## Outbound contracts
## Data, identity, and lifecycle mapping
## Authentication and context propagation
## Error, retry, fallback, and compatibility behavior
## Configuration, ownership, and release
## Evidence and exclusions
```

For adapter-specific detail attached to a canonical operation record:

```markdown
## Adapter transformation
- Mapper/handler entry:
- Field/identity/default transformations:
- Context and credential propagation:
- Error and fallback mapping:
```

## Granularity and relationships

Group mappings that share the same boundary pair and transformation policy.
Split when protocol authority, ownership, lifecycle, or failure semantics
differ. Do not publish every DTO, converter, generated client, or transport
helper separately.

Add structured edges only for concrete registration and call paths. Keep a
narrative locator when dynamic dispatch prevents an unambiguous edge.

Return `identityGroups` when several target identities share one explained
adapter responsibility. Return every source-backed adjacency in
`chainCandidates`, then provide one `chainCandidateDecisions` record for each
candidate. A documented decision names the reader-facing view and emits its
structured edge; an equivalent candidate merges into that canonical candidate;
false positives and missing external material use `exclude` or `request-input`
with a concrete reason. Read `contracts-and-chains.md` for the complete generic
contract.

## Template composition examples

- An HTTP endpoint backed by an RPC client is `api-service` + `adapter-integration`; combine
  one operation registry with one mapping contract rather than duplicating the
  route facts.
- A host plugin bridge reads `plugin-extension.md` and may also be `sdk-library`
  when consumers import
  a supported extension API.
- A compatibility wrapper over generated clients also reads
  `derived-generated-source.md` and identifies the authoritative schemas.

## Revise or stop when

- either side of the adapter cannot be identified;
- mappings are inferred only from same-named types or fields;
- credential, identity, or error behavior would be guessed;
- generated DTOs are replacing authoritative contracts in the plan;
- the adapter page would merely say that one module “calls” another.
