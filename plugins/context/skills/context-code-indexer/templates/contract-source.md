---
id: context.code-indexer.template.contract-source
kind: procedure
media-type: text/markdown
---

# Authoritative contract source template

Use for `contract-source`: a module whose maintained value is an authoritative
IDL, OpenAPI document, schema registry, message contract, or equivalent
machine-readable interface definition. It defines contracts consumed by other
modules but does not need to execute or dispatch them itself.

Use the exact profile and Artifact policy variant supplied by the workset.
Generated projections must point back to this authority and remain supporting
evidence rather than a second contract authority.

## Evidence pass

Locate:

- schema roots, namespaces/packages, service or message registries, and imports;
- operation, event, request, response, and error identities;
- versioning, compatibility, deprecation, and evolution rules;
- generator configuration, target languages/packages, and generated output
  boundaries;
- known provider and consumer registrations when those modules are registered;
- ownership, validation, publication, and release entrypoints.

## Questions the knowledge must answer

1. Which contracts are authoritative in this module?
2. How are operations/messages grouped and identified?
3. What versioning and compatibility rules are declared?
4. Which generated artifacts and consumers derive from this source?
5. How is the contract validated, published, and changed?

## Suggested knowledge units

- **Contract registry**: namespaces, service/message families, authority,
  versions, owners, and navigation.
- **Operation or message-family reference**: exact identities, payload roles,
  errors, compatibility, and generated targets.
- **Generation and publication map**: generator inputs/outputs, validation,
  versioning, and release boundary.
- **Provider-consumer flow**: only when both runtime endpoints are registered
  and source-backed; use the cross-module template.

## Chapter blueprint

```markdown
# <Contract module> registry
## Authority, ownership, and schema roots
## Namespaces and contract families
## Operations, messages, and error identities
## Versioning, compatibility, and deprecation
## Generated targets and active consumers
## Validation, publication, and release
## Evidence and exclusions
```

Use the canonical operation record from `protocol-boundary.md` for detailed
families. Do not duplicate every generated language binding or claim runtime
behavior from the schema alone.

## Granularity and stop conditions

Aggregate related operations/messages by authoritative family. Split when
namespace, owner, version policy, or compatibility behavior differs. Every page
must contain exact contract identities and source locators, not just filenames.

Revise or stop when authority cannot be distinguished from a generated copy,
imports or versions are unresolved, or compatibility claims are not declared.
