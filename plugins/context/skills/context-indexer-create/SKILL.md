---
name: context-indexer-create
description: Use when the user explicitly asks to create a new Context Indexer Provider Skill for code, documents, notes or session summaries. Do not activate for indexing existing sources, ordinary coding, knowledge queries or selecting an installed Provider.
user-invocable: false
metadata:
  context-role: "authoring-assistant"
  context-public-entry: "false"
---

# Create a Context Indexer

Create a reusable Provider in the user's chosen directory. This is a Skill-writing
assistant, not a Provider or a production Route. Use the conversation language.
An explicit request to make a new Indexer is sufficient; the user need not name
this Skill. Do not initialize a knowledge workspace to write a Provider.

## Establish the intended result

Reuse the stated source type, readers, tasks and desired output. Ask only about
missing choices that affect interpretation or ownership: should the new Provider
replace an existing primary, or contribute to another Provider's pages? Notes
may become FAQs, decisions or corrections; session summaries may or may not link
to code changes. Do not force a taxonomy, a commit association, or one page per
source. Distinguish a reusable Provider from a workspace-only wording/template
change; explain the smaller option without refusing a requested new Provider.

## Read the matching contracts and examples

Read [the authoring guide](references/guides/indexer-skill-creation.md), then the
relevant sections of [the Provider protocol](references/reference/indexer-provider-protocol.md).
Use the SDK version compatible with the intended CLI, rather than recalling
schema fields from another release. These references are copied from the SDK
at plugin build time; the installed schema remains the executable authority.

- Code: [Code authoring](references/guides/code-indexer-skill-authoring.md).
- Documents: [Markdown authoring](references/guides/markdown-indexer-skill-authoring.md).
- Notes: [Note sources](references/guides/note.md).
- Sessions: [Session sources](references/guides/sessions.md).
- Composition and selection: [Provider customization](references/guides/indexer-provider-and-customization.md).

Inspect the matching existing Provider's actual SKILL.md, context-indexer.yaml,
selected instruction references and one relevant template. Use a Host-visible
Skill path or the installed CLI catalog's guidance paths; do not crawl host
caches or require this repository's developer paths. If examples or the SDK are
unavailable, explain which validation remains unavailable. Do not invent a
successful validation or silently install dependencies.

## Write a complete, bounded Provider

Deliver SKILL.md, context-indexer.yaml, the declared instructions and useful
page templates. Add anonymous fixtures and validation instructions. Add programs
only for an actual unsupported extraction need; ordinary source interpretation
and writing belong to the Agent. Derive manifest capabilities and resources
from what the new bundle actually implements, not everything in the example.

Use one context.indexer.provider/v1 manifest for all four source families.
Note and Sessions currently use the markdown domain with their own target kinds
and profiles; do not invent new protocol domains. A resource must be declared
so the lifecycle can send it to the Agent: an unreferenced reference file is
not enough. Preserve stable source/subject identity, evidence bindings and
revision boundaries; keep nonessential metadata out of knowledge frontmatter.

The new Provider does not own source authorization, scheduling, approval,
close/build or publication. Return the current operation's declared results.
Do not turn suggestions in notes or sessions into established implementation
facts, and do not manufacture raw transcripts from summaries.

## Validate and hand off

Follow the guide's manifest, resource, template and fixture checks in an isolated
test directory. Test the intended reader output, insufficient material, revision
of an existing page, and composition when advertised. Cover only the source
families claimed by this Provider. Report static validation separately from an
actual lifecycle run; a valid YAML file alone is not a working Provider.

Summarize the created files, supported inputs, ownership/composition, tests and
remaining limitations. Explain the user's chosen installation channel and host
Skill switch. Installation/enabling does not select a Provider for a workspace.
Only hand off to the existing Context production Skill when the user asks to
use it there; that Skill follows a fresh Route for Provider selection.
