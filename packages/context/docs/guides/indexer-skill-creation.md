# Creating a reusable Indexer Skill

A Provider is a portable Skill bundle. Workspace-local customization changes a
selected Provider for one workspace; it is not the packaging format for a new
Provider. Start from the source interpretation and reader task, then choose
primary replacement or an advertised extension.

## Package and protocol

A typical instruction-only bundle contains:

```text
context-example-indexer/
  SKILL.md
  context-indexer.yaml
  references/indexer.md
  references/writing.md
  templates/reader-guide.md
```

The name is illustrative. Use a discoverable context-…-indexer… name and an
explicit Provider identity/version. SKILL.md describes when the lifecycle may
select it; context-indexer.yaml declares context.indexer.provider/v1, domains,
activation, profiles, operations and resources. Instructions and templates must
be declared for the profiles using them. Do not copy unused profiles, composers
or resource paths. Do not add a provider manifest to the creation assistant itself.

Start from the [minimal manifest](indexer-manifest-example.md), which gives the
field tree in three groups: required, required once a capability is declared, and
optional. Read the [protocol](../reference/indexer-provider-protocol.md) for the
subsystem rules behind those fields — selection validation, partition authority,
overlays, controlled invocation — and the [selection
guide](indexer-provider-and-customization.md) for composition.
The four built-in examples are context-code-indexer, context-markdown-indexer,
context-note-indexer and context-sessions-indexer. The latter two are independent
source interpreters using markdown-domain contracts. Use their source-specific
references instead of making a Markdown Provider accept everything.

## Find a real example

If Context CLI is available, inspect `context indexer catalog --format json`.
Use the selected entry's guidance.skill_path and guidance.manifest_path to locate
its bundle; read only that example and its declared resources. Alternatively use
an exact Host-exposed installed Skill. Do not guess cache paths. This read-only
catalog use is for Provider development, not a new production discovery gate.

Choose one profile and follow its manifest references through instructions and
template to its declared results. A code example demonstrates parser facts and
public APIs; a document example demonstrates evidence-based consolidation;
a note example demonstrates excerpts versus summaries; a sessions example
separates decisions, rejected proposals and optional change associations.
Adapt behavior, not only names. The example's breadth is not a minimum feature
requirement for a specialized Provider.

## Validate against the installed SDK

Use the matching SDK's public exports. For community installations the package
is @c4a/context; for an internal distribution use its supplied SDK coordinates.
With the SDK available, this Node ESM check validates the manifest and declared resource paths:

```js
import { loadIndexerProviderManifest } from '@c4a/context';
const manifest = await loadIndexerProviderManifest(process.argv[2]);
console.log(manifest.id, manifest.version);
```

The argument is the Skill bundle directory. This check does not establish that
all resources are usable or that the Provider can produce useful pages. Check
all declared resource paths stay within the bundle and exist; validate templates
with the SDK template loader and their declared profile contracts. Consult the
installed exported signatures before writing the runner: do not invent a CLI
validate command or fabricate a production Route to run a development check.

Template protocol is context.indexer.template/v1. Semantic prose and deterministic
Facts have separate variables; registered renderers own program blocks. A
Provider cannot invent a renderer or an arbitrary document kind. Use supported
profile/artifact contracts or the existing declared overlay mechanism.

Use anonymous fixtures that demonstrate the advertised source interpretation:
one useful result, material that cannot support a claim, and an existing-page
update. Test primary/extension ownership only if that composition is advertised.
Test the complete selected bundle in a disposable workspace through the normal
lifecycle when the necessary CLI and materials are available. Preserve the
user's live workspace. Record exact commands and failures; clearly distinguish
schema/resource checks from semantic review and lifecycle verification.

## Distribution and use

Keep references and templates inside the bundle, with portable relative paths.
The complete runtime file ledger determines integrity; do not hand-write a hash
or copy another bundle's integrity. Use the target distribution's existing
packaging/resolution tools. Development fixtures need not be shipped as runtime
resources. Installation may use any supported organizational channel.

A business Provider may be enabled through the host and selected instead of the
default. Prefixes aid discovery; the manifest and verified resources determine
compatibility. Select through the current Context Provider-selection Route when
the user requests actual use. No new CLI install registry or creation-specific
production state is needed.
