---
name: context-indexer-create
description: Use when the user explicitly asks to create a new Context Indexer Skill for code, documents, notes or session summaries. Do not activate for indexing existing sources, ordinary coding, knowledge queries or selecting an installed skill.
user-invocable: false
metadata:
  context-role: "authoring-assistant"
  context-public-entry: "false"
---

# Create a Context Indexer

Create a reusable skill in the user's chosen directory. This assistant writes
skills; it does not initialize a knowledge workspace or start production.
Use the conversation language and ask only for missing source, reader or
capability choices that materially affect the requested result.

Read [the authoring guide](references/guides/indexer-skill-creation.md).
When a relevant example is available, inspect its actual host-visible SKILL.md
and only the references needed for this source family. Do not crawl caches,
load every installed skill or require an exact Provider version.

Every Indexer starts with a useful skeleton: source structure, recognizable
features, names, counts when actually established, and entry locations.
Planning may use direct Agent investigation or a bounded helper appropriate
to the technology. Detailed parsing and behavior analysis are separate,
optional writing-time work. One module may use several skills.

Deliver SKILL.md and only useful references, templates or scripts. Do not
generate a Provider registration manifest, primary/extension binding, version
or hash verification flow, per-symbol fact ledger or persistent producer log.
The current Context stage supplies purpose, scope, scheduling and submission
schemas; the new skill contributes investigation and writing guidance.

Validate the skill's references and any scripts, then exercise realistic
anonymous material for its claimed capability. Distinguish static validation
from model output review and a real production run. Do not silently install
dependencies or claim tests that could not run.

Report created files, supported inputs, bounded helper behavior and remaining
limitations. Installation makes a skill available, not selected. Start actual
Context production only when requested, through its existing entry and route.
