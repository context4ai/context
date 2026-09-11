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

## Overview maps for a selected contract family

When the user chooses a bounded overview, organize the page as scope/version,
contract-family map, representative operations, active consumers, lookup procedure,
change/generation entrypoints and unread boundaries. Separate API entry schemas,
domain contracts, runtime RPC/message boundaries and common models when the source
actually distinguishes them. Do not force these layers onto an unrelated schema.

A useful family row contains purpose, authoritative directory/file, known consumer
and the next lookup. A representative operation row can connect reader action,
external operation identity, schema Service/Method and implementation locator;
mark an unknown hop as a question, never a proven call. Count only with a recorded
file-set boundary or reproducible inventory; a few examples cannot establish
complete coverage or a total operation count. Cross-file imports needed to explain
a selected type are supporting evidence, not automatic new article subjects.

For large groups, directory routes with scoped searches are preferable to thousands
of file rows. Give an actual lookup example and what to do when no match is found.
A short article does not imply cheap extraction: the confirmed overview treatment
must first be expressible in the actual source/production configuration. This
writing template does not change parser depth. If the current contract profile
would still prepare the entire source, resolve that scope before proceeding;
do not silently select another profile or claim deferred parsing already happened.

## Prefer linked definitions over schema transcription

For entry-first knowledge, avoid exhaustive IDL reading and rewriting. Start with
consumer/generator configuration and known operation identities; inspect only the
definitions needed for the actual claim. A file locator does not prove its fields
or runtime use. Keep complete schema bodies out of Markdown unless a short excerpt
is necessary to explain the reader's question. Do not modify authoritative IDL.

A source-backed attachment is useful only when an article explicitly needs and
links that exact definition. Repository presence alone never selects an asset.
If a supported source-resource projection exists, use its registered source,
revision, relative path and byte digest; never copy the entire IDL tree or hand-write
knowledge/assets. Otherwise retain a versioned source locator and state that the
offline attachment is unavailable. The existing document-attachment mechanism is
not proof that repository files have been registered as source assets.

An attached IDL remains source evidence, not a second authoritative contract or
an instruction to create another article. Include dependencies are added only
when needed for the documented use; distinguish a readable excerpt from a complete,
compilable schema bundle. Do not claim the attachment compiles unless verified.
Source byte changes must invalidate the affected resource and dependent evidence;
unchanged bytes can reuse the resource. A repository revision change alone does
not prove a changed definition, and source bytes changing do not prove a breaking
API change. Preserve source identity even when identical bytes share storage.
